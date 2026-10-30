export type DuelPreviewFixture = {
  fixtureId: string;
  competitionCode: "PL" | "PD" | "CL";
  competitionName: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  kickoffUtc: string;
  providerStatus: "TIMED" | "SCHEDULED";
  eligibility: "eligible" | "display_only";
  featuredReason?: string;
};

export const duelPreviewFixtureEvent = "stakemate:prepare-duel";

export function fixtureHandoffKey(fixture: Pick<DuelPreviewFixture, "competitionCode" | "fixtureId">) {
  return `${fixture.competitionCode}:${fixture.fixtureId}`;
}

/** Client-side guard only; the draft route repeats exact-fixture verification server-side. */
export function assertPreviewFixtureEligible(fixture: DuelPreviewFixture, now = Date.now()) {
  if (!/^\d+$/u.test(fixture.fixtureId) || fixture.providerStatus !== "TIMED" || fixture.eligibility !== "eligible" || !Number.isFinite(Date.parse(fixture.kickoffUtc)) || Date.parse(fixture.kickoffUtc) <= now || !fixture.homeTeam.id || !fixture.awayTeam.id || fixture.homeTeam.id === fixture.awayTeam.id) throw new Error("This fixture is no longer eligible for a preview-only duel. Refresh fixtures and choose a current TIMED match.");
  return fixture;
}

export function samePreviewFixture(first: DuelPreviewFixture, second: DuelPreviewFixture) {
  return fixtureHandoffKey(first) === fixtureHandoffKey(second) && first.kickoffUtc === second.kickoffUtc && first.homeTeam.id === second.homeTeam.id && first.awayTeam.id === second.awayTeam.id && first.providerStatus === second.providerStatus && first.eligibility === second.eligibility;
}

export function openDuelPreview(fixture: DuelPreviewFixture) {
  assertPreviewFixtureEligible(fixture);
  window.dispatchEvent(new CustomEvent<DuelPreviewFixture>(duelPreviewFixtureEvent, { detail: fixture }));
  document.getElementById("prepare-duel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
