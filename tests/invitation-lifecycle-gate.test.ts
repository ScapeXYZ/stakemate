import assert from "node:assert/strict";
import test from "node:test";
import { assertInvitationLifecycleEnabled, invitationLifecycleEnabled, isolatedInvitationPilotEnabled } from "../src/lib/server/invitation-lifecycle-gate";
import { outcomeDeadlineForCore } from "../src/lib/server/invitation-policy";

test("real invitation lifecycle requires two explicit server-only gates", () => {
  const lifecycle = process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED;
  const canonical = process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED;
  try {
    delete process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED; delete process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED;
    assert.equal(invitationLifecycleEnabled(), false);
    process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED = "true";
    assert.equal(invitationLifecycleEnabled(), false);
    process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED = "true";
    assert.equal(invitationLifecycleEnabled(), true);
  } finally {
    if (lifecycle === undefined) delete process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED; else process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED = lifecycle;
    if (canonical === undefined) delete process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED; else process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED = canonical;
  }
});

test("pilot UI gate requires exact loopback database, localhost origin, and both lifecycle flags", () => {
  const saved = { database: process.env.DATABASE_URL, origin: process.env.STAKEMATE_PUBLIC_ORIGIN, lifecycle: process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED, canonical: process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED };
  try {
    process.env.DATABASE_URL = "postgres://pilot:only@127.0.0.1:55435/stakemate_integration17"; process.env.STAKEMATE_PUBLIC_ORIGIN = "http://localhost:3001"; process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED = "true"; process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED = "true";
    assert.equal(isolatedInvitationPilotEnabled(), true); assert.doesNotThrow(assertInvitationLifecycleEnabled);
    process.env.STAKEMATE_PUBLIC_ORIGIN = "https://stakemate.example"; assert.equal(isolatedInvitationPilotEnabled(), false);
    process.env.STAKEMATE_PUBLIC_ORIGIN = "http://localhost:3001"; process.env.DATABASE_URL = "postgres://pilot:only@db.example:55435/stakemate"; assert.equal(isolatedInvitationPilotEnabled(), false);
  } finally {
    if (saved.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.database;
    if (saved.origin === undefined) delete process.env.STAKEMATE_PUBLIC_ORIGIN; else process.env.STAKEMATE_PUBLIC_ORIGIN = saved.origin;
    if (saved.lifecycle === undefined) delete process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED; else process.env.STAKEMATE_INVITATION_LIFECYCLE_ENABLED = saved.lifecycle;
    if (saved.canonical === undefined) delete process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED; else process.env.STAKEMATE_CANONICAL_INVITATIONS_ENABLED = saved.canonical;
  }
});

test("outcome deadline is derived from server policy, never request input", () => {
  const prior = process.env.STAKEMATE_INVITATION_OUTCOME_WINDOW_HOURS;
  try {
    process.env.STAKEMATE_INVITATION_OUTCOME_WINDOW_HOURS = "72";
    const deadline = outcomeDeadlineForCore({ version: "stakemate.football-1x2-duel.v2", provider: "football-data.org/v4", competitionCode: "PL", competitionName: "Premier League", fixtureId: "fixture", homeTeamId: "1", homeTeam: "Home", awayTeamId: "2", awayTeam: "Away", kickoffUtc: "2030-01-01T00:00:00.000Z", creatorAddress: "0x" + "1".repeat(64), opponentAddress: "0x" + "2".repeat(64), creatorSelection: "home_win", opponentSelection: "away_win", unselectedOutcome: "draw", stakeMist: "100000000", invitationLifetimeMinutes: 15, voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure" });
    assert.equal(deadline, "2030-01-04T00:00:00.000Z");
  } finally { if (prior === undefined) delete process.env.STAKEMATE_INVITATION_OUTCOME_WINDOW_HOURS; else process.env.STAKEMATE_INVITATION_OUTCOME_WINDOW_HOURS = prior; }
});
