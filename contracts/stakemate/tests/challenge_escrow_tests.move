#[test_only]
module stakemate::challenge_escrow_tests;

use stakemate::challenge_escrow::{Self, Challenge};
use sui::clock::{Self, Clock};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};
use sui::transfer;

const CREATOR: address = @0xA11CE;
const OPPONENT: address = @0xB0B;
const AUTHORITY: address = @0xA0;
const ATTACKER: address = @0xBAD;
const STAKE: u64 = 100;
const FUNDING_DEADLINE: u64 = 10;
const OUTCOME_DEADLINE: u64 = 20;

fun terms(): vector<u8> { vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] }

#[test]
fun creator_wins_normal_settlement() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    settle(&mut s, AUTHORITY, 1);
    s.next_tx(CREATOR);
    let payout = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&payout) == STAKE * 2, 100);
    transfer::public_transfer(payout, CREATOR);
    s.end();
}

#[test]
#[expected_failure(abort_code = 7)]
fun non_opponent_cannot_fund() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(ATTACKER);
    let mut c = s.take_shared<Challenge>();
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::accept_and_fund(&mut c, stake, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.end();
}

#[test]
#[expected_failure(abort_code = 10)]
fun incorrect_stake_is_rejected() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(OPPONENT);
    let mut c = s.take_shared<Challenge>();
    let stake = coin::mint_for_testing<SUI>(STAKE - 1, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::accept_and_fund(&mut c, stake, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.end();
}

#[test]
#[expected_failure(abort_code = 10)]
fun overpayment_is_rejected_without_funding() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(OPPONENT);
    let mut c = s.take_shared<Challenge>();
    let stake = coin::mint_for_testing<SUI>(STAKE + 1, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::accept_and_fund(&mut c, stake, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1)]
fun zero_creator_stake_is_rejected() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    s.next_tx(CREATOR);
    let stake = coin::mint_for_testing<SUI>(0, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::create(OPPONENT, stake, terms(), FUNDING_DEADLINE, OUTCOME_DEADLINE, AUTHORITY, &clock, s.ctx());
    test_scenario::return_shared(clock);
    s.end();
}

#[test]
#[expected_failure(abort_code = 0)]
fun self_challenge_is_rejected() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    s.next_tx(CREATOR);
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::create(CREATOR, stake, terms(), FUNDING_DEADLINE, OUTCOME_DEADLINE, AUTHORITY, &clock, s.ctx());
    test_scenario::return_shared(clock);
    s.end();
}

#[test]
#[expected_failure(abort_code = 12)]
fun participant_cannot_be_outcome_authority() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    s.next_tx(CREATOR);
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::create(OPPONENT, stake, terms(), FUNDING_DEADLINE, OUTCOME_DEADLINE, CREATOR, &clock, s.ctx());
    test_scenario::return_shared(clock);
    s.end();
}

#[test]
#[expected_failure(abort_code = 12)]
fun zero_address_cannot_be_outcome_authority() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    s.next_tx(CREATOR);
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::create(OPPONENT, stake, terms(), FUNDING_DEADLINE, OUTCOME_DEADLINE, @0x0, &clock, s.ctx());
    test_scenario::return_shared(clock);
    s.end();
}

#[test]
#[expected_failure(abort_code = 13)]
fun stake_that_cannot_form_a_winner_payout_is_rejected() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    s.next_tx(CREATOR);
    let stake = coin::mint_for_testing<SUI>((std::u64::max_value!() / 2) + 1, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::create(OPPONENT, stake, terms(), FUNDING_DEADLINE, OUTCOME_DEADLINE, AUTHORITY, &clock, s.ctx());
    test_scenario::return_shared(clock);
    s.end();
}

#[test]
#[expected_failure(abort_code = 3)]
fun equal_deadlines_are_rejected() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    s.next_tx(CREATOR);
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::create(OPPONENT, stake, terms(), FUNDING_DEADLINE, FUNDING_DEADLINE, AUTHORITY, &clock, s.ctx());
    test_scenario::return_shared(clock);
    s.end();
}

#[test]
#[expected_failure(abort_code = 8)]
fun non_authority_cannot_settle() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    settle(&mut s, ATTACKER, 1);
    s.end();
}

#[test]
fun opponent_wins_normal_settlement() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    settle(&mut s, AUTHORITY, 2);
    s.next_tx(OPPONENT);
    let payout = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&payout) == STAKE * 2, 106);
    transfer::public_transfer(payout, OPPONENT);
    s.end();
}

#[test]
fun creator_can_cancel_before_acceptance() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(CREATOR);
    let mut c = s.take_shared<Challenge>();
    challenge_escrow::cancel_unfunded(&mut c, s.ctx());
    test_scenario::return_shared(c);
    s.next_tx(CREATOR);
    let refund = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&refund) == STAKE, 107);
    transfer::public_transfer(refund, CREATOR);
    s.end();
}

#[test]
#[expected_failure(abort_code = 6)]
fun non_creator_cannot_cancel_unfunded_challenge() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(OPPONENT);
    let mut c = s.take_shared<Challenge>();
    challenge_escrow::cancel_unfunded(&mut c, s.ctx());
    test_scenario::return_shared(c);
    s.end();
}

#[test]
#[expected_failure(abort_code = 4)]
fun opponent_cannot_fund_after_deadline() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(OPPONENT);
    let mut c = s.take_shared<Challenge>();
    let mut clock = s.take_shared<Clock>();
    clock::set_for_testing(&mut clock, FUNDING_DEADLINE);
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    challenge_escrow::accept_and_fund(&mut c, stake, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.end();
}

#[test]
fun tie_refunds_exact_stakes() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    settle(&mut s, AUTHORITY, 0);
    s.next_tx(CREATOR);
    let creator_refund = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&creator_refund) == STAKE, 101);
    transfer::public_transfer(creator_refund, CREATOR);
    s.next_tx(OPPONENT);
    let opponent_refund = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&opponent_refund) == STAKE, 102);
    transfer::public_transfer(opponent_refund, OPPONENT);
    s.end();
}

#[test]
fun expired_funding_returns_creator_stake() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(ATTACKER);
    let mut c = s.take_shared<Challenge>();
    let mut clock = s.take_shared<Clock>();
    clock::set_for_testing(&mut clock, FUNDING_DEADLINE);
    challenge_escrow::refund_expired_funding(&mut c, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.next_tx(CREATOR);
    let refund = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&refund) == STAKE, 103);
    transfer::public_transfer(refund, CREATOR);
    s.end();
}

#[test]
#[expected_failure(abort_code = 4)]
fun funding_refund_is_rejected_before_the_exact_deadline() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(ATTACKER);
    let mut c = s.take_shared<Challenge>();
    let clock = s.take_shared<Clock>();
    challenge_escrow::refund_expired_funding(&mut c, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.end();
}

#[test]
fun unreported_outcome_refunds_both_participants() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    s.next_tx(ATTACKER);
    let mut c = s.take_shared<Challenge>();
    let mut clock = s.take_shared<Clock>();
    clock::set_for_testing(&mut clock, OUTCOME_DEADLINE);
    challenge_escrow::void_unreported_outcome(&mut c, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.next_tx(CREATOR);
    let refund = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&refund) == STAKE, 104);
    transfer::public_transfer(refund, CREATOR);
    s.next_tx(OPPONENT);
    let refund = s.take_from_sender<coin::Coin<SUI>>();
    assert!(coin::value(&refund) == STAKE, 105);
    transfer::public_transfer(refund, OPPONENT);
    s.end();
}

#[test]
#[expected_failure(abort_code = 9)]
fun duplicate_funding_is_rejected() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    fund_challenge(&mut s);
    s.end();
}

#[test]
#[expected_failure(abort_code = 9)]
fun terminal_challenge_cannot_settle_twice() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    settle(&mut s, AUTHORITY, 1);
    settle(&mut s, AUTHORITY, 1);
    s.end();
}

#[test]
#[expected_failure(abort_code = 11)]
fun invalid_outcome_is_rejected() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    settle(&mut s, AUTHORITY, 3);
    s.end();
}

#[test]
#[expected_failure(abort_code = 9)]
fun terminal_challenge_cannot_be_refunded_twice() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    s.next_tx(CREATOR);
    let mut c = s.take_shared<Challenge>();
    challenge_escrow::cancel_unfunded(&mut c, s.ctx());
    test_scenario::return_shared(c);
    s.next_tx(ATTACKER);
    let mut c = s.take_shared<Challenge>();
    let mut clock = s.take_shared<Clock>();
    clock::set_for_testing(&mut clock, FUNDING_DEADLINE);
    challenge_escrow::refund_expired_funding(&mut c, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.end();
}

#[test]
#[expected_failure(abort_code = 5)]
fun authority_cannot_report_after_outcome_deadline() {
    let mut s = test_scenario::begin(CREATOR);
    test_scenario::create_system_objects(&mut s);
    create_challenge(&mut s);
    fund_challenge(&mut s);
    s.next_tx(AUTHORITY);
    let mut c = s.take_shared<Challenge>();
    let mut clock = s.take_shared<Clock>();
    clock::set_for_testing(&mut clock, OUTCOME_DEADLINE);
    challenge_escrow::submit_outcome(&mut c, 1, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
    s.end();
}

fun create_challenge(s: &mut Scenario) {
    s.next_tx(CREATOR);
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::create(OPPONENT, stake, terms(), FUNDING_DEADLINE, OUTCOME_DEADLINE, AUTHORITY, &clock, s.ctx());
    test_scenario::return_shared(clock);
}

fun fund_challenge(s: &mut Scenario) {
    s.next_tx(OPPONENT);
    let mut c = s.take_shared<Challenge>();
    let stake = coin::mint_for_testing<SUI>(STAKE, s.ctx());
    let clock = s.take_shared<Clock>();
    challenge_escrow::accept_and_fund(&mut c, stake, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
}

fun settle(s: &mut Scenario, sender: address, outcome: u8) {
    s.next_tx(sender);
    let mut c = s.take_shared<Challenge>();
    let clock = s.take_shared<Clock>();
    challenge_escrow::submit_outcome(&mut c, outcome, &clock, s.ctx());
    test_scenario::return_shared(clock);
    test_scenario::return_shared(c);
}
