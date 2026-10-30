import assert from "node:assert/strict";
import test from "node:test";
import { memoryRecordSchema, normalizeMemoryRecord, serializeMemoryRecord } from "../src/lib/memory/records";
import { invitationMemoryEvents, uniqueInvitationMemoryEvents, verifiedMatchResultMemoryEvent } from "../src/lib/server/invitation-memory-events";
import type { CanonicalInvitation } from "../src/lib/server/canonical-invitation-persistence";

const invitation: CanonicalInvitation = {
  id: "invite-1", status: "accepted", creatorProfileId: "creator-profile", recipientProfileId: "recipient-profile", creatorWalletAddress: `0x${"1".repeat(64)}`, recipientWalletAddress: `0x${"2".repeat(64)}`,
  core: { version: "stakemate.football-1x2-duel.v2", provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: "123", homeTeamId: "h", homeTeam: "Home", awayTeamId: "a", awayTeam: "Away", kickoffUtc: "2030-01-02T12:00:00.000Z", creatorAddress: `0x${"1".repeat(64)}`, opponentAddress: `0x${"2".repeat(64)}`, creatorSelection: "home_win", opponentSelection: "away_win", unselectedOutcome: "draw", stakeMist: "100000000", invitationLifetimeMinutes: 15, voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure" },
  coreBytes: "canonical", coreHash: `0x${"a".repeat(64)}`, invitationExpiresAtUtc: "2030-01-01T00:15:00.000Z", createdAtUtc: "2030-01-01T00:00:00.000Z", statusChangedAtUtc: "2030-01-01T00:02:00.000Z", outcomeDeadlineUtc: "2030-01-03T00:00:00.000Z", acceptedChallenge: null, acceptedChallengeBytes: null, acceptedChallengeHash: null, acceptedWalletAddress: null, fundingDeadlineAtUtc: null,
};

test("canonical invitation events preserve both predictions, transition provenance, and idempotent IDs", () => {
  const first = invitationMemoryEvents(invitation);
  const second = invitationMemoryEvents(invitation);
  assert.equal(first.length, 4);
  assert.deepEqual(first.map((record) => record.id), second.map((record) => record.id));
  assert.equal(new Set(first.map((record) => record.id)).size, 4);
  assert.equal(first.filter((record) => record.type === "player.prediction").length, 2);
  const acceptance = first.find((record) => record.type === "challenge.history" && record.status === "accepted");
  assert.equal(acceptance?.provenance?.source, "canonical_postgres_invitation");
  assert.equal(acceptance?.provenance?.commitmentHash, invitation.coreHash);
  for (const record of first) { assert.doesNotThrow(() => memoryRecordSchema.parse(record)); assert.match(serializeMemoryRecord(record), /"schemaVersion":2/); }
  assert.equal(uniqueInvitationMemoryEvents([invitation, invitation]).length, 4);
});

test("memory serialization normalizes invitation hash notation only at the schema-v2 boundary", () => {
  const rawHashInvitation = { ...invitation, coreHash: "a".repeat(64) };
  const records = invitationMemoryEvents(rawHashInvitation);
  const history = records.find((record) => record.type === "challenge.history");
  assert.equal(rawHashInvitation.coreHash, "a".repeat(64));
  assert.equal(history?.termsHash, `0x${"a".repeat(64)}`);
  assert.equal(history?.provenance?.commitmentHash, `0x${"a".repeat(64)}`);
  assert.doesNotThrow(() => normalizeMemoryRecord(history));
});

test("only a verified result produces a canonical result candidate and draw is explicit", () => {
  const result = verifiedMatchResultMemoryEvent({ invitation, verifiedAt: "2030-01-02T14:00:00.000Z", homeScore: 1, awayScore: 1, evidenceRef: "football-data.org/v4/matches/123" });
  assert.equal(result.type, "match.result");
  assert.equal(result.result, "draw");
  assert.equal(result.provenance?.source, "football-data.org/v4");
  assert.match(serializeMemoryRecord(result), /football-data.org/);
});
