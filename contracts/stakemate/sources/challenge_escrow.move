/// Testnet-only, two-party SUI challenge escrow.
/// The outcome authority is a named, immutable trusted resolver. It is not an oracle.
module stakemate::challenge_escrow;

use std::vector;
use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, ID, UID};
use sui::sui::SUI;
use sui::transfer;
use sui::tx_context::{Self, TxContext};

/// Challenge has been created and creator funding is held.
const CREATED: u8 = 0;
/// Both exact stakes have been deposited.
const FUNDED: u8 = 1;
/// Funds have been returned; no future action can pay out.
const VOIDED: u8 = 2;
/// Funds have been paid to one participant; no future action can pay out.
const SETTLED: u8 = 3;

const OUTCOME_VOID_OR_TIE: u8 = 0;
const OUTCOME_CREATOR_WIN: u8 = 1;
const OUTCOME_OPPONENT_WIN: u8 = 2;

const E_SELF_CHALLENGE: u64 = 0;
const E_ZERO_STAKE: u64 = 1;
const E_BAD_TERMS_HASH: u64 = 2;
const E_BAD_DEADLINES: u64 = 3;
const E_FUNDING_EXPIRED: u64 = 4;
const E_OUTCOME_EXPIRED: u64 = 5;
const E_WRONG_CREATOR: u64 = 6;
const E_WRONG_OPPONENT: u64 = 7;
const E_WRONG_AUTHORITY: u64 = 8;
const E_WRONG_STATE: u64 = 9;
const E_WRONG_STAKE: u64 = 10;
const E_BAD_OUTCOME: u64 = 11;
/// The resolver must be an independently controlled, non-zero address.
const E_INVALID_OUTCOME_AUTHORITY: u64 = 12;
/// Two equal deposits must be joinable into one `Balance<SUI>` for a winner payout.
const E_STAKE_TOO_LARGE: u64 = 13;

/// Only public, protocol-essential terms are stored. Sensitive challenge details stay off-chain.
public struct Challenge has key {
    id: UID,
    creator: address,
    opponent: address,
    stake_mist: u64,
    terms_hash: vector<u8>,
    funding_deadline_ms: u64,
    outcome_deadline_ms: u64,
    outcome_authority: address,
    creator_funding: Balance<SUI>,
    opponent_funding: Balance<SUI>,
    state: u8,
}

public struct ChallengeCreated has copy, drop {
    challenge_id: ID,
    creator: address,
    opponent: address,
    stake_mist: u64,
    funding_deadline_ms: u64,
    outcome_deadline_ms: u64,
    outcome_authority: address,
}

public struct ChallengeFunded has copy, drop { challenge_id: ID, opponent: address }
public struct ChallengeSettled has copy, drop { challenge_id: ID, winner: address, payout_mist: u64 }
public struct ChallengeVoided has copy, drop { challenge_id: ID, creator_refund_mist: u64, opponent_refund_mist: u64 }

/// Creation escrows exactly the creator stake. `terms_hash` must be a 32-byte digest
/// calculated off-chain from canonical, non-sensitive terms.
entry fun create(
    opponent: address,
    stake: Coin<SUI>,
    terms_hash: vector<u8>,
    funding_deadline_ms: u64,
    outcome_deadline_ms: u64,
    outcome_authority: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let creator = tx_context::sender(ctx);
    assert!(creator != opponent, E_SELF_CHALLENGE);
    assert!(coin::value(&stake) > 0, E_ZERO_STAKE);
    // A participant-controlled resolver can unilaterally award itself the escrow.
    // The zero address cannot sign a transaction, so it would force a timeout refund.
    assert!(outcome_authority != @0x0 && outcome_authority != creator && outcome_authority != opponent, E_INVALID_OUTCOME_AUTHORITY);
    // Winner settlement joins the two deposits. Keep the sum within `u64` so a
    // valid, fully funded challenge cannot become unpayable through arithmetic overflow.
    assert!(coin::value(&stake) <= std::u64::max_value!() / 2, E_STAKE_TOO_LARGE);
    assert!(vector::length(&terms_hash) == 32, E_BAD_TERMS_HASH);
    assert!(clock::timestamp_ms(clock) < funding_deadline_ms && funding_deadline_ms < outcome_deadline_ms, E_BAD_DEADLINES);
    let stake_mist = coin::value(&stake);
    let challenge = Challenge {
        id: object::new(ctx), creator, opponent, stake_mist, terms_hash,
        funding_deadline_ms, outcome_deadline_ms, outcome_authority,
        creator_funding: coin::into_balance(stake), opponent_funding: balance::zero<SUI>(), state: CREATED,
    };
    event::emit(ChallengeCreated { challenge_id: object::id(&challenge), creator, opponent, stake_mist, funding_deadline_ms, outcome_deadline_ms, outcome_authority });
    transfer::share_object(challenge);
}

/// The immutable opponent deposits one and only one exact stake before funding expiry.
entry fun accept_and_fund(challenge: &mut Challenge, stake: Coin<SUI>, clock: &Clock, ctx: &TxContext) {
    assert!(challenge.state == CREATED, E_WRONG_STATE);
    assert!(tx_context::sender(ctx) == challenge.opponent, E_WRONG_OPPONENT);
    assert!(clock::timestamp_ms(clock) < challenge.funding_deadline_ms, E_FUNDING_EXPIRED);
    assert!(coin::value(&stake) == challenge.stake_mist, E_WRONG_STAKE);
    // `Balance` is linear (no drop); join the exact deposit into its zero placeholder.
    balance::join(&mut challenge.opponent_funding, coin::into_balance(stake));
    challenge.state = FUNDED;
    event::emit(ChallengeFunded { challenge_id: object::id(challenge), opponent: challenge.opponent });
}

/// Before acceptance, the creator can cancel and recover only their own stake.
entry fun cancel_unfunded(challenge: &mut Challenge, ctx: &mut TxContext) {
    assert!(challenge.state == CREATED, E_WRONG_STATE);
    assert!(tx_context::sender(ctx) == challenge.creator, E_WRONG_CREATOR);
    let amount = balance::value(&challenge.creator_funding);
    let refund = coin::from_balance(balance::withdraw_all(&mut challenge.creator_funding), ctx);
    challenge.state = VOIDED;
    transfer::public_transfer(refund, challenge.creator);
    event::emit(ChallengeVoided { challenge_id: object::id(challenge), creator_refund_mist: amount, opponent_refund_mist: 0 });
}

/// Anyone may recover creator funds after the opponent misses the funding deadline.
/// The destination is fixed to the immutable creator address, never the caller.
entry fun refund_expired_funding(challenge: &mut Challenge, clock: &Clock, ctx: &mut TxContext) {
    assert!(challenge.state == CREATED, E_WRONG_STATE);
    assert!(clock::timestamp_ms(clock) >= challenge.funding_deadline_ms, E_FUNDING_EXPIRED);
    let amount = balance::value(&challenge.creator_funding);
    let refund = coin::from_balance(balance::withdraw_all(&mut challenge.creator_funding), ctx);
    challenge.state = VOIDED;
    transfer::public_transfer(refund, challenge.creator);
    event::emit(ChallengeVoided { challenge_id: object::id(challenge), creator_refund_mist: amount, opponent_refund_mist: 0 });
}

/// Only the immutable outcome authority may resolve an active challenge before its deadline.
/// Outcome 1 pays creator, 2 pays opponent, and 0 (tie/void) refunds exact stakes.
entry fun submit_outcome(challenge: &mut Challenge, outcome: u8, clock: &Clock, ctx: &mut TxContext) {
    assert!(challenge.state == FUNDED, E_WRONG_STATE);
    assert!(tx_context::sender(ctx) == challenge.outcome_authority, E_WRONG_AUTHORITY);
    assert!(clock::timestamp_ms(clock) < challenge.outcome_deadline_ms, E_OUTCOME_EXPIRED);
    assert!(outcome == OUTCOME_VOID_OR_TIE || outcome == OUTCOME_CREATOR_WIN || outcome == OUTCOME_OPPONENT_WIN, E_BAD_OUTCOME);
    if (outcome == OUTCOME_VOID_OR_TIE) {
        void_and_refund(challenge, ctx);
    } else {
        let mut payout = balance::withdraw_all(&mut challenge.creator_funding);
        balance::join(&mut payout, balance::withdraw_all(&mut challenge.opponent_funding));
        let winner = if (outcome == OUTCOME_CREATOR_WIN) challenge.creator else challenge.opponent;
        let payout_mist = balance::value(&payout);
        challenge.state = SETTLED;
        transfer::public_transfer(coin::from_balance(payout, ctx), winner);
        event::emit(ChallengeSettled { challenge_id: object::id(challenge), winner, payout_mist });
    }
}

/// If the authority has not reported by the immutable outcome deadline, anyone may
/// void the challenge. The caller cannot choose recipients or amounts.
entry fun void_unreported_outcome(challenge: &mut Challenge, clock: &Clock, ctx: &mut TxContext) {
    assert!(challenge.state == FUNDED, E_WRONG_STATE);
    assert!(clock::timestamp_ms(clock) >= challenge.outcome_deadline_ms, E_OUTCOME_EXPIRED);
    void_and_refund(challenge, ctx);
}

fun void_and_refund(challenge: &mut Challenge, ctx: &mut TxContext) {
    let creator_amount = balance::value(&challenge.creator_funding);
    let opponent_amount = balance::value(&challenge.opponent_funding);
    let creator_refund = coin::from_balance(balance::withdraw_all(&mut challenge.creator_funding), ctx);
    let opponent_refund = coin::from_balance(balance::withdraw_all(&mut challenge.opponent_funding), ctx);
    challenge.state = VOIDED;
    transfer::public_transfer(creator_refund, challenge.creator);
    transfer::public_transfer(opponent_refund, challenge.opponent);
    event::emit(ChallengeVoided { challenge_id: object::id(challenge), creator_refund_mist: creator_amount, opponent_refund_mist: opponent_amount });
}

public fun id(challenge: &Challenge): ID { object::id(challenge) }
public fun state(challenge: &Challenge): u8 { challenge.state }
public fun stake_mist(challenge: &Challenge): u64 { challenge.stake_mist }
public fun participants(challenge: &Challenge): (address, address) { (challenge.creator, challenge.opponent) }
public fun deadlines(challenge: &Challenge): (u64, u64) { (challenge.funding_deadline_ms, challenge.outcome_deadline_ms) }

#[test_only]
public fun state_for_testing(challenge: &Challenge): u8 { challenge.state }
