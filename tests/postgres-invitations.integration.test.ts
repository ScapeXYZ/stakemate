import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { CanonicalInvitationPersistenceAdapter } from "../src/lib/server/canonical-invitation-persistence";
import { DurableSettlementWorker } from "../src/lib/server/durable-settlement-worker";
import { PostgresInvitationStore } from "../src/lib/server/postgres-invitations";
import { createAuthenticationNonce, verifyAuthenticationSignature } from "../src/lib/server/wallet-auth";
import type { FootballDuelCoreTerms } from "../src/lib/football-duel-terms";

const url = process.env.STAKEMATE_TEST_DATABASE_URL;
const disposable = process.env.STAKEMATE_POSTGRES_INTEGRATION_DISPOSABLE === "1";
const localUrl = (() => { try { const host = url ? new URL(url).hostname : ""; return host === "127.0.0.1" || host === "localhost"; } catch { return false; } })();
const skip = disposable && localUrl ? false : "requires STAKEMATE_POSTGRES_INTEGRATION_DISPOSABLE=1 and a localhost STAKEMATE_TEST_DATABASE_URL";
const wallet = (byte: string) => `0x${byte.repeat(64)}`;
const freshWallet = (label: string) => `0x${createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex")}`;

test("localhost adapter connects without TLS and persists a one-use wallet authentication record", { skip }, async () => {
  const previous = process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE;
  const store = new PostgresInvitationStore(url!); const keypair = Ed25519Keypair.generate(); const now = new Date();
  try {
    await store.connectionTest();
    const challenge = await createAuthenticationNonce(store, keypair.toSuiAddress(), "http://localhost:3001", now);
    assert.equal((await store.nonceByValue(challenge.nonce))?.usedAt, null);
    const signed = await keypair.signPersonalMessage(new TextEncoder().encode(challenge.message));
    const verified = await verifyAuthenticationSignature(store, { walletAddress: keypair.toSuiAddress(), nonce: challenge.nonce, messageBytes: signed.bytes, signature: signed.signature, origin: "http://localhost:3001" }, now);
    assert.equal(verified.walletAddress, keypair.toSuiAddress());
    assert.ok((await store.nonceByValue(challenge.nonce))?.usedAt);
    await store.createSession({ id: randomUUID(), tokenHash: `pilot-${randomUUID()}`, walletAddress: keypair.toSuiAddress(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), revokedAt: null, createdAt: now.toISOString() });
  } finally {
    await store.close(); if (previous === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = previous;
  }
});

test("PostgreSQL enforces permanent case-insensitive username ownership under races", { skip }, async () => {
  const previous = process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE;
  const store = new PostgresInvitationStore(url!); const suffix = randomUUID().replaceAll("-", "").slice(0, 12); const first = freshWallet("username-first"); const second = freshWallet("username-second"); const third = freshWallet("username-third");
  try {
    const owner = await store.claimUsername(first, `Virus${suffix}`, new Date());
    await assert.rejects(() => store.claimUsername(first, `Other${suffix}`, new Date()), /USERNAME_ALREADY_CLAIMED/);
    await assert.rejects(() => store.claimUsername(second, `virus${suffix}`, new Date()), /USERNAME_TAKEN/);
    const raceName = `race${suffix}`;
    const race = await Promise.allSettled([store.claimUsername(second, raceName, new Date()), store.claimUsername(third, raceName.toUpperCase(), new Date())]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await store.profileForWallet(first))?.username, owner.username);
  } finally { await store.close(); if (previous === undefined) delete process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE; else process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE = previous; }
});

test("disposable PostgreSQL enforces concurrent acceptance, idempotency, immutability, and rollback", { skip }, async () => {
  const sql = postgres(url!, { ssl: false, max: 4 });
  const creatorId = randomUUID(); const recipientId = randomUUID(); const invitationId = randomUUID();
  const creator = freshWallet("concurrent-creator"); const recipient = freshWallet("concurrent-recipient"); const authority = freshWallet("concurrent-authority"); const coreHash = createHash("sha256").update(randomUUID()).digest("hex"); const challengeHash = `0x${createHash("sha256").update(randomUUID()).digest("hex")}`;
  try {
    await sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${creatorId}, ${creator}, ${`creator_${creatorId.slice(0, 8)}`}, ${`creator_${creatorId.slice(0, 8)}`}, clock_timestamp(), clock_timestamp()), (${recipientId}, ${recipient}, ${`recipient_${recipientId.slice(0, 8)}`}, ${`recipient_${recipientId.slice(0, 8)}`}, clock_timestamp(), clock_timestamp())`;
    await sql`insert into stakemate_invitations (id, creator_profile_id, recipient_profile_id, status, duel_terms_hash, creator_wallet_address, recipient_wallet_address, terms_canonical, terms_hash, terms_json, funding_status, created_at, expires_at, outcome_deadline_at, canonical_core_version, canonical_core_bytes, canonical_core_hash, fixture_provider, fixture_id, competition_code, kickoff_at, creator_selection, opponent_selection, unselected_outcome, stake_mist) values (${invitationId}, ${creatorId}, ${recipientId}, 'pending', ${coreHash}, ${creator}, ${recipient}, 'legacy', ${coreHash}, ${sql.json({})}, 'not_funded', clock_timestamp(), clock_timestamp() + interval '10 minutes', clock_timestamp() + interval '1 day', 'stakemate.football-1x2-duel.v2', 'core-bytes', ${coreHash}, 'football-data.org/v4', 'fixture-42', 'PL', clock_timestamp() + interval '2 days', 'home_win', 'away_win', 'draw', '100000000')`;
    const accept = () => sql`with instant as (select clock_timestamp() as now) update stakemate_invitations set status = 'accepted', responded_at = instant.now, accepted_wallet_address = ${recipient}, funding_deadline_at = instant.now + interval '15 minutes', accepted_challenge_version = 'stakemate.challenge-terms.v1', accepted_challenge_bytes = 'accepted-bytes', accepted_challenge_hash = ${challengeHash}, accepted_outcome_authority = ${authority} from instant where id = ${invitationId} and status = 'pending' and expires_at > instant.now and instant.now + interval '15 minutes' < outcome_deadline_at returning id`;
    const [first, second] = await Promise.all([accept(), accept()]);
    assert.equal(first.count + second.count, 1);
    const wrongWallet = await sql`update stakemate_invitations set status = 'accepted' where id = ${invitationId} and status = 'pending' and recipient_wallet_address = ${wallet("9")}`;
    assert.equal(wrongWallet.count, 0);
    await assert.rejects(() => sql`update stakemate_invitations set accepted_challenge_bytes = 'tampered' where id = ${invitationId}`, /immutable/);
    const key = "c".repeat(64); const request = "d".repeat(64);
    const idempotent = () => sql`insert into stakemate_invitation_idempotency (actor_wallet_address, operation, key_hash, request_hash, invitation_id, response_status, completed_at) values (${recipient}, 'accept', ${key}, ${request}, ${invitationId}, 'completed', clock_timestamp())`;
    const result = await Promise.allSettled([idempotent(), idempotent()]);
    assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
    const rollbackId = randomUUID();
    await assert.rejects(() => sql.begin(async (tx) => { await tx`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${rollbackId}, ${wallet("4")}, ${`rollback_${rollbackId.slice(0, 8)}`}, ${`rollback_${rollbackId.slice(0, 8)}`}, clock_timestamp(), clock_timestamp())`; throw new Error("force rollback"); }), /force rollback/);
    const [rolledBack] = await sql`select count(*)::int as count from stakemate_profiles where id = ${rollbackId}`;
    assert.equal(rolledBack.count, 0);
    const expiredId = randomUUID();
    await sql`insert into stakemate_invitations (id, creator_profile_id, recipient_profile_id, status, duel_terms_hash, creator_wallet_address, recipient_wallet_address, terms_canonical, terms_hash, terms_json, funding_status, created_at, expires_at, outcome_deadline_at, canonical_core_version, canonical_core_bytes, canonical_core_hash, fixture_provider, fixture_id, competition_code, kickoff_at, creator_selection, opponent_selection, unselected_outcome, stake_mist) values (${expiredId}, ${creatorId}, ${recipientId}, 'pending', ${"e".repeat(64)}, ${creator}, ${recipient}, 'legacy', ${"e".repeat(64)}, ${sql.json({})}, 'not_funded', clock_timestamp() - interval '11 minutes', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 day', 'stakemate.football-1x2-duel.v2', 'expired-core', ${"e".repeat(64)}, 'football-data.org/v4', 'fixture-expired', 'PL', clock_timestamp() + interval '2 days', 'home_win', 'away_win', 'draw', '100000000')`;
    const expiredAccept = await sql`update stakemate_invitations set status = 'accepted' where id = ${expiredId} and status = 'pending' and expires_at > clock_timestamp()`;
    assert.equal(expiredAccept.count, 0);
    const markedExpired = await sql`update stakemate_invitations set status = 'expired' where id = ${expiredId} and status = 'pending' and expires_at <= clock_timestamp()`;
    assert.equal(markedExpired.count, 1);
    const rls = await sql`select relname, relrowsecurity from pg_class where relname in ('stakemate_profiles', 'stakemate_auth_nonces', 'stakemate_sessions', 'stakemate_invitations', 'stakemate_invitation_idempotency') order by relname`;
    assert.equal(rls.length, 5); assert.ok(rls.every((row) => row.relrowsecurity === true));
    const browserRole = `stakemate_browser_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await sql.unsafe(`create role ${browserRole} nologin`);
    await sql.unsafe(`grant select on stakemate_invitations to ${browserRole}`);
    const visible = await sql.begin(async (tx) => { await tx.unsafe(`set local role ${browserRole}`); return tx`select count(*)::int as count from stakemate_invitations`; });
    assert.equal(visible[0].count, 0);
    const [canInsert] = await sql`select has_table_privilege(${browserRole}, 'stakemate_invitations', 'INSERT') as allowed`;
    assert.equal(canInsert.allowed, false);
  } finally { await sql.end({ timeout: 5 }); }
});

test("gated canonical persistence adapter atomically persists lifecycle commitments", { skip }, async () => {
  const sql = postgres(url!, { ssl: false, max: 2 }); const creator = freshWallet("adapter-creator"); const recipient = freshWallet("adapter-recipient"); const authority = freshWallet("adapter-authority"); const creatorId = randomUUID(); const recipientId = randomUUID();
  const suffix = randomUUID().slice(0, 8); const future = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(); const outcome = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
  const core: FootballDuelCoreTerms = { version: "stakemate.football-1x2-duel.v2", provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: `adapter-${suffix}`, homeTeamId: "1", homeTeam: "Home", awayTeamId: "2", awayTeam: "Away", kickoffUtc: future, creatorAddress: creator, opponentAddress: recipient, creatorSelection: "home_win", opponentSelection: "away_win", unselectedOutcome: "draw", stakeMist: "100000000", invitationLifetimeMinutes: 15, voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure" };
  // The integration suite may run with the local pilot flags enabled. Construct
  // this negative-control adapter with its flag explicitly absent so the test
  // continues to prove that persistence cannot be reached by default.
  const priorCanonicalFlag = process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED; delete process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED;
  const disabled = new CanonicalInvitationPersistenceAdapter(url!, { ssl: false });
  if (priorCanonicalFlag === undefined) delete process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED; else process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED = priorCanonicalFlag;
  const adapter = new CanonicalInvitationPersistenceAdapter(url!, { ssl: false, enabledForIntegrationTest: true });
  try {
    await sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${creatorId}, ${creator}, ${`adapter_c_${suffix}`}, ${`adapter_c_${suffix}`}, clock_timestamp(), clock_timestamp()), (${recipientId}, ${recipient}, ${`adapter_r_${suffix}`}, ${`adapter_r_${suffix}`}, clock_timestamp(), clock_timestamp())`;
    await assert.rejects(() => disabled.create({ authenticatedCreatorWallet: creator, recipientWalletAddress: recipient, core, outcomeDeadlineUtc: outcome, idempotencyKey: "a".repeat(16) }), /DISABLED/);
    const created = await adapter.create({ authenticatedCreatorWallet: creator, recipientWalletAddress: recipient, core, outcomeDeadlineUtc: outcome, idempotencyKey: "b".repeat(16) });
    const replay = await adapter.create({ authenticatedCreatorWallet: creator, recipientWalletAddress: recipient, core, outcomeDeadlineUtc: outcome, idempotencyKey: "b".repeat(16) });
    assert.equal(created.id, replay.id); assert.equal(created.coreHash, replay.coreHash); assert.equal(created.status, "pending");
    const accepted = await Promise.allSettled([adapter.respond({ invitationId: created.id, authenticatedWallet: recipient, action: "accept", outcomeAuthority: authority, idempotencyKey: "c".repeat(16) }), adapter.respond({ invitationId: created.id, authenticatedWallet: recipient, action: "accept", outcomeAuthority: authority, idempotencyKey: "d".repeat(16) })]);
    assert.equal(accepted.filter((item) => item.status === "fulfilled").length, 1);
    const winner = accepted.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof adapter.respond>>> => item.status === "fulfilled")!.value;
    assert.equal(winner.status, "accepted"); assert.equal(winner.acceptedWalletAddress, recipient); assert.equal(winner.acceptedChallenge?.outcomeAuthority, authority); assert.ok(winner.acceptedChallengeHash?.startsWith("0x"));
    const creatorInbox = await adapter.inbox(creator); const recipientInbox = await adapter.inbox(recipient); const strangerInbox = await adapter.inbox(wallet("8"));
    assert.ok(creatorInbox.sent.some((item) => item.id === created.id)); assert.ok(recipientInbox.received.some((item) => item.id === created.id)); assert.equal(strangerInbox.sent.length + strangerInbox.received.length, 0);
    await assert.rejects(() => adapter.respond({ invitationId: created.id, authenticatedWallet: recipient, action: "accept", outcomeAuthority: authority, idempotencyKey: "e".repeat(16) }), /NOT_PENDING/);
    await assert.rejects(() => adapter.respond({ invitationId: created.id, authenticatedWallet: creator, action: "cancel", idempotencyKey: "j".repeat(16) }), /NOT_PENDING/);
    const rejected = await adapter.create({ authenticatedCreatorWallet: creator, recipientWalletAddress: recipient, core: { ...core, fixtureId: `reject-${suffix}` }, outcomeDeadlineUtc: outcome, idempotencyKey: "f".repeat(16) });
    assert.equal((await adapter.respond({ invitationId: rejected.id, authenticatedWallet: recipient, action: "reject", idempotencyKey: "g".repeat(16) })).status, "rejected");
    const cancelled = await adapter.create({ authenticatedCreatorWallet: creator, recipientWalletAddress: recipient, core: { ...core, fixtureId: `cancel-${suffix}` }, outcomeDeadlineUtc: outcome, idempotencyKey: "h".repeat(16) });
    assert.equal((await adapter.respond({ invitationId: cancelled.id, authenticatedWallet: creator, action: "cancel", idempotencyKey: "i".repeat(16) })).status, "cancelled");
  } finally { await adapter.close(); await disabled.close(); await sql.end({ timeout: 5 }); }
});

test("isolated @temitope and @Virus pilot records create-send-accept and create-send-reject audit states", { skip }, async () => {
  const sql = postgres(url!, { ssl: false, max: 2 }); const suffix = randomUUID().replaceAll("-", "").slice(0, 12); const creator = `0x${suffix.padEnd(64, "d")}`; const recipient = `0x${suffix.padEnd(63, "e")}f`; const authority = wallet("f"); const creatorId = randomUUID(); const recipientId = randomUUID();
  const fixtureId = `${Math.floor(Date.now() / 1_000)}`; const kickoff = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString(); const outcome = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
  const core = (id: string): FootballDuelCoreTerms => ({ version: "stakemate.football-1x2-duel.v2", provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: id, homeTeamId: "101", homeTeam: "Synthetic Home", awayTeamId: "202", awayTeam: "Synthetic Away", kickoffUtc: kickoff, creatorAddress: creator, opponentAddress: recipient, creatorSelection: "home_win", opponentSelection: "away_win", unselectedOutcome: "draw", stakeMist: "100000000", invitationLifetimeMinutes: 10, voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure" });
  const adapter = new CanonicalInvitationPersistenceAdapter(url!, { ssl: false, enabledForIntegrationTest: true });
  try {
    // These are fixed synthetic addresses in a localhost-only tmpfs database;
    // they are not the real wallets behind the public handles.
    await sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${creatorId}, ${creator}, ${`temitope${suffix}`}, ${`temitope${suffix}`}, clock_timestamp(), clock_timestamp()), (${recipientId}, ${recipient}, ${`Virus${suffix}`}, ${`virus${suffix}`}, clock_timestamp(), clock_timestamp())`;
    const accepted = await adapter.create({ authenticatedCreatorWallet: creator, recipientWalletAddress: recipient, core: core(fixtureId), outcomeDeadlineUtc: outcome, idempotencyKey: "pilot-create-accept" });
    assert.equal(accepted.status, "pending");
    const acceptedReplay = await adapter.respond({ invitationId: accepted.id, authenticatedWallet: recipient, action: "accept", outcomeAuthority: authority, idempotencyKey: "pilot-accept-once" });
    const duplicate = await adapter.respond({ invitationId: accepted.id, authenticatedWallet: recipient, action: "accept", outcomeAuthority: authority, idempotencyKey: "pilot-accept-once" });
    assert.equal(acceptedReplay.status, "accepted"); assert.equal(duplicate.acceptedChallengeHash, acceptedReplay.acceptedChallengeHash);
    const rejected = await adapter.create({ authenticatedCreatorWallet: creator, recipientWalletAddress: recipient, core: core(`${Number(fixtureId) + 1}`), outcomeDeadlineUtc: outcome, idempotencyKey: "pilot-create-reject" });
    const rejectedResult = await adapter.respond({ invitationId: rejected.id, authenticatedWallet: recipient, action: "reject", idempotencyKey: "pilot-reject-once" });
    assert.equal(rejectedResult.status, "rejected");
    const audit = await adapter.inbox(creator); const stateById = new Map(audit.sent.map((item) => [item.id, item.status]));
    assert.deepEqual({ createSendAccept: stateById.get(accepted.id), createSendReject: stateById.get(rejected.id), funding: acceptedReplay.acceptedChallenge ? "not_requested" : "unexpected" }, { createSendAccept: "accepted", createSendReject: "rejected", funding: "not_requested" });
  } finally { await adapter.close(); await sql.end({ timeout: 5 }); }
});

test("durable settlement worker leases, recovers, reconciles, and never broadcasts", { skip }, async () => {
  const sql = postgres(url!, { ssl: false, max: 6 });
  const suffix = randomUUID().slice(0, 8); const creatorId = randomUUID(); const recipientId = randomUUID();
  const creator = freshWallet("worker-creator"); const recipient = freshWallet("worker-recipient"); const worker = new DurableSettlementWorker(url!, { ssl: false, enabledForIntegrationTest: true });
  const disabled = new DurableSettlementWorker(url!, { ssl: false });
  const addJob = async (name: string, state: "pending" | "leased" | "retry_wait" = "pending", transactionDigest: string | null = null) => {
    const invitationId = randomUUID(); const decisionId = randomUUID(); const jobId = randomUUID(); const evidenceHash = createHash("sha256").update(`evidence:${suffix}:${name}`).digest("hex");
    const decisionHash = createHash("sha256").update(`decision:${suffix}:${name}`).digest("hex"); const idempotencyKey = createHash("sha256").update(`job:${suffix}:${name}`).digest("hex"); const challengeHash = `0x${createHash("sha256").update(`challenge:${suffix}:${name}`).digest("hex")}`;
    await sql`insert into stakemate_invitations (id, creator_profile_id, recipient_profile_id, status, duel_terms_hash, creator_wallet_address, recipient_wallet_address, terms_canonical, terms_hash, terms_json, funding_status, created_at, expires_at, outcome_deadline_at, canonical_core_version, canonical_core_bytes, canonical_core_hash, fixture_provider, fixture_id, competition_code, kickoff_at, creator_selection, opponent_selection, unselected_outcome, stake_mist, accepted_challenge_version, accepted_challenge_bytes, accepted_challenge_hash, accepted_outcome_authority, accepted_wallet_address, responded_at, funding_deadline_at) values (${invitationId}, ${creatorId}, ${recipientId}, 'accepted', ${evidenceHash}, ${creator}, ${recipient}, 'durable', ${evidenceHash}, ${sql.json({})}, 'not_funded', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '10 minutes', clock_timestamp() + interval '1 day', 'stakemate.football-1x2-duel.v2', ${`core-${name}`}, ${evidenceHash}, 'football-data.org/v4', ${`fixture-${name}`}, 'PL', clock_timestamp() + interval '2 days', 'home_win', 'away_win', 'draw', '100000000', 'stakemate.challenge-terms.v1', ${`challenge-${name}`}, ${challengeHash}, ${wallet("c")}, ${recipient}, clock_timestamp() - interval '19 minutes', clock_timestamp() - interval '4 minutes')`;
    await sql`insert into stakemate_settlement_decisions (id, invitation_id, evidence_hash, verification_state, result_outcome, expected_move_outcome, correction_window_ends_at, rationale, decision_hash) values (${decisionId}, ${invitationId}, ${evidenceHash}, 'verified', 'home_win', 1, clock_timestamp() - interval '1 minute', 'two independent mock sources', ${decisionHash})`;
    await sql`insert into stakemate_settlement_jobs (id, invitation_id, decision_id, status, attempt_count, lease_owner, lease_expires_at, run_after, idempotency_key, expected_move_outcome, move_challenge_id, funding_confirmed_at, transaction_digest) values (${jobId}, ${invitationId}, ${decisionId}, ${state}, ${state === "leased" ? 1 : 0}, ${state === "leased" ? "crashed-worker" : null}, ${state === "leased" ? sql`clock_timestamp() - interval '1 second'` : null}, clock_timestamp() - interval '1 second', ${idempotencyKey}, 1, ${wallet("d")}, clock_timestamp() - interval '2 hours', ${transactionDigest})`;
    return { invitationId, decisionId, jobId, evidenceHash };
  };
  try {
    await sql`insert into stakemate_profiles (id, wallet_address, username, username_normalized, created_at, updated_at) values (${creatorId}, ${creator}, ${`durable_c_${suffix}`}, ${`durable_c_${suffix}`}, clock_timestamp(), clock_timestamp()), (${recipientId}, ${recipient}, ${`durable_r_${suffix}`}, ${`durable_r_${suffix}`}, clock_timestamp(), clock_timestamp())`;
    await assert.rejects(() => disabled.claim("disabled-worker"), /DISABLED/);
    const primary = await addJob("primary");
    const claims = await Promise.all([worker.claim("worker-one"), worker.claim("worker-two")]);
    assert.equal(claims.filter(Boolean).length, 1); assert.equal(claims.find(Boolean)?.id, primary.jobId);
    const prepared = await worker.prepare(primary.jobId, claims.find(Boolean)!.leaseOwner!);
    assert.equal(prepared.job.status, "prepared"); assert.equal(prepared.broadcasted, false); assert.match(prepared.job.lastError!, /DISABLED/);
    await assert.rejects(() => sql`insert into stakemate_settlement_jobs (invitation_id, decision_id, status, idempotency_key, expected_move_outcome, move_challenge_id, funding_confirmed_at) values (${primary.invitationId}, ${primary.decisionId}, 'pending', ${"f".repeat(64)}, 1, ${wallet("e")}, clock_timestamp())`, /duplicate key/);
    await sql`insert into stakemate_result_evidence (invitation_id, source_id, source_kind, fixture_provider, fixture_id, competition_code, kickoff_at, match_state, home_score_regulation, away_score_regulation, observed_at, retrieved_at, provenance, evidence_hash) values (${primary.invitationId}, 'mock-primary', 'provider', 'football-data.org/v4', 'fixture-primary', 'PL', clock_timestamp() + interval '2 days', 'final', 2, 1, clock_timestamp(), clock_timestamp(), ${sql.json({ source: "mock" })}, ${"1".repeat(64)})`;
    await sql`insert into stakemate_result_evidence (invitation_id, source_id, source_kind, fixture_provider, fixture_id, competition_code, kickoff_at, match_state, home_score_regulation, away_score_regulation, observed_at, retrieved_at, supersedes_evidence_id, provenance, evidence_hash) select invitation_id, 'mock-correction', 'licensed_secondary', fixture_provider, fixture_id, competition_code, kickoff_at, 'final', 2, 1, clock_timestamp(), clock_timestamp(), id, ${sql.json({ source: "mock-correction" })}, ${"2".repeat(64)} from stakemate_result_evidence where invitation_id = ${primary.invitationId} limit 1`;
    await assert.rejects(() => sql`update stakemate_result_evidence set provenance = ${sql.json({ tampered: true })} where invitation_id = ${primary.invitationId}`, /append-only/);
    const crashed = await addJob("crashed", "leased"); const recovered = await worker.recoverExpiredLeases();
    assert.ok(recovered.some((item) => item.id === crashed.jobId && item.status === "retry_wait"));
    // The recovery backoff is deliberate; advance only the disposable test row.
    await sql`update stakemate_settlement_jobs set run_after = clock_timestamp() - interval '1 second' where id = ${crashed.jobId}`;
    const retryClaim = await worker.claim("recovery-worker"); assert.equal(retryClaim?.id, crashed.jobId);
    const ambiguous = await addJob("ambiguous", "leased", "0xmock-transaction"); const ambiguousRecovery = await worker.recoverExpiredLeases();
    assert.equal(ambiguousRecovery.find((item) => item.id === ambiguous.jobId)?.status, "broadcast_pending");
    const reconciled = await worker.reconcileMockReceipt(ambiguous.jobId, "confirmed"); assert.equal(reconciled.status, "confirmed"); assert.equal(reconciled.confirmationStatus, "confirmed");
    const paused = await addJob("paused"); await sql`update stakemate_settlement_control set emergency_paused = true, pause_reason = 'integration emergency pause', updated_at = clock_timestamp() where singleton = true`;
    assert.equal(await worker.claim("paused-worker"), null); await sql`update stakemate_settlement_control set emergency_paused = false, pause_reason = null, updated_at = clock_timestamp() where singleton = true`;
    const resumed = await worker.claim("resumed-worker"); assert.equal(resumed?.id, paused.jobId);
    const [audit] = await sql`select id from stakemate_settlement_audit where job_id = ${primary.jobId} limit 1`;
    await assert.rejects(() => sql`delete from stakemate_settlement_audit where id = ${audit.id}`, /append-only/);
  } finally { await worker.close(); await disabled.close(); await sql.end({ timeout: 5 }); }
});

test("proposed anon/authenticated grant revocation preserves owner-only server access", { skip }, async () => {
  const sql = postgres(url!, { ssl: false, max: 1 }); const role = `stakemate_browser_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const tables = ["stakemate_profiles", "stakemate_auth_nonces", "stakemate_sessions", "stakemate_invitations", "stakemate_invitation_idempotency", "stakemate_result_evidence", "stakemate_settlement_decisions", "stakemate_settlement_control", "stakemate_settlement_jobs", "stakemate_settlement_audit"];
  try {
    await sql.unsafe(`create role ${role} nologin`);
    await sql.unsafe(`grant all privileges on table ${tables.join(", ")} to ${role}`);
    await sql.unsafe(`revoke all privileges on table ${tables.join(", ")} from ${role}`);
    const privileges = await sql`select table_name, has_table_privilege(${role}, table_name, 'SELECT') as readable, has_table_privilege(${role}, table_name, 'INSERT') as writable from information_schema.tables where table_schema = 'public' and table_name = any(${tables}) order by table_name`;
    assert.equal(privileges.length, tables.length); assert.ok(privileges.every((item) => item.readable === false && item.writable === false));
    const [owner] = await sql`select has_table_privilege(current_user, 'stakemate_invitations', 'SELECT') as readable, has_table_privilege(current_user, 'stakemate_invitations', 'INSERT') as writable`;
    assert.equal(owner.readable, true); assert.equal(owner.writable, true);
  } finally { await sql.end({ timeout: 5 }); }
});

test("proposed function revocations leave no StakeMate sequences and preserve owner control", { skip }, async () => {
  const sql = postgres(url!, { ssl: false, max: 1 }); const role = `stakemate_browser_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const functions = ["stakemate_guard_invitation_commitment()", "stakemate_reject_settlement_history_mutation()"];
  try {
    await sql.unsafe(`create role ${role} nologin`);
    for (const fn of functions) {
      await sql.unsafe(`grant execute on function ${fn} to public, ${role}`);
      await sql.unsafe(`revoke execute on function ${fn} from public, ${role}`);
      const [browser] = await sql.unsafe(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') as allowed`);
      const [owner] = await sql.unsafe(`select has_function_privilege(current_user, '${fn}', 'EXECUTE') as allowed`);
      assert.equal(browser.allowed, false); assert.equal(owner.allowed, true);
    }
    const [sequences] = await sql`select count(*)::int as count from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'stakemate_%'`;
    assert.equal(sequences.count, 0);
  } finally { await sql.end({ timeout: 5 }); }
});
