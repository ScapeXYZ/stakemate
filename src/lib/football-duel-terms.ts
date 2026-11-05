import { sha256 } from "@noble/hashes/sha2.js";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { DuelDraftTerms, OneXTwoSelection } from "@/lib/duel-draft";

export type FootballDuelCoreTerms = {
  version: "stakemate.football-1x2-duel.v2"; provider: string; competitionCode: "PL" | "PD" | "CL"; competitionName: string; fixtureId: string;
  homeTeamId: string; homeTeam: string; awayTeamId: string; awayTeam: string; kickoffUtc: string;
  creatorAddress: string; opponentAddress: string; creatorSelection: OneXTwoSelection; opponentSelection: OneXTwoSelection; unselectedOutcome: OneXTwoSelection;
  stakeMist: string; invitationLifetimeMinutes: 10 | 15; voidRule: "full_principal_refund_for_unselected_outcome_or_provider_failure";
};
export type FootballDuelChallengeTerms = FootballDuelCoreTerms & { invitationExpiresAtUtc: string; fundingDeadlineUtc: string; outcomeDeadlineUtc: string; outcomeAuthority: string };
const address = (value: string) => normalizeSuiAddress(value).toLowerCase();
const iso = (value: string, field: string) => { const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${field} must be ISO UTC.`); return parsed; };
const safe = (value: string, field: string) => { const result = value.normalize("NFC").trim(); if (!result || /[\r\n=]/u.test(result)) throw new Error(`${field} is invalid.`); return result; };

function validatedCore(core: FootballDuelCoreTerms): FootballDuelCoreTerms {
  if (core.version !== "stakemate.football-1x2-duel.v2") throw new Error("Unsupported football duel terms version.");
  if (!(["PL", "PD", "CL"] as const).includes(core.competitionCode)) throw new Error("Unsupported competition code.");
  if (!(["home_win", "draw", "away_win"] as const).includes(core.creatorSelection) || !(["home_win", "draw", "away_win"] as const).includes(core.opponentSelection) || !(["home_win", "draw", "away_win"] as const).includes(core.unselectedOutcome) || new Set([core.creatorSelection, core.opponentSelection, core.unselectedOutcome]).size !== 3) throw new Error("1X2 selections must be three distinct outcomes.");
  if (!/^\d+$/u.test(core.stakeMist) || BigInt(core.stakeMist) <= BigInt(0)) throw new Error("stakeMist must be a positive MIST integer.");
  if (core.invitationLifetimeMinutes !== 10 && core.invitationLifetimeMinutes !== 15) throw new Error("Invitation lifetime must be 10 or 15 minutes.");
  if (core.voidRule !== "full_principal_refund_for_unselected_outcome_or_provider_failure") throw new Error("Unsupported void/refund rule.");
  iso(core.kickoffUtc, "kickoffUtc");
  const creatorAddress = address(core.creatorAddress); const opponentAddress = address(core.opponentAddress);
  if (creatorAddress === opponentAddress) throw new Error("A wallet cannot duel itself.");
  return { ...core, provider: safe(core.provider, "provider"), competitionName: safe(core.competitionName, "competition"), fixtureId: safe(core.fixtureId, "fixture ID"), homeTeamId: safe(core.homeTeamId, "home team ID"), homeTeam: safe(core.homeTeam, "home team"), awayTeamId: safe(core.awayTeamId, "away team ID"), awayTeam: safe(core.awayTeam, "away team"), creatorAddress, opponentAddress };
}

/** Terms fixed at draft creation. Usernames, provider retrieval timestamps, and future deadlines are deliberately excluded. */
export function coreFromDraft(terms: DuelDraftTerms): FootballDuelCoreTerms {
  if (terms.creatorSelection === terms.opponentSelection || terms.unselectedOutcome === terms.creatorSelection || terms.unselectedOutcome === terms.opponentSelection) throw new Error("1X2 selections must be three distinct outcomes.");
  if (!/^\d+$/u.test(terms.stakeMist) || BigInt(terms.stakeMist) <= BigInt(0)) throw new Error("stakeMist must be a positive MIST integer.");
  const creatorAddress = address(terms.creator.walletAddress); const opponentAddress = address(terms.opponent.walletAddress); if (creatorAddress === opponentAddress) throw new Error("A wallet cannot duel itself.");
  if (Date.parse(terms.fixture.kickoffUtc) <= Date.now()) throw new Error("Fixture kickoff must remain future.");
  return { version: "stakemate.football-1x2-duel.v2", provider: safe(terms.fixture.provider, "provider"), competitionCode: terms.fixture.competitionCode, competitionName: safe(terms.fixture.competitionName, "competition"), fixtureId: safe(terms.fixture.fixtureId, "fixture ID"), homeTeamId: safe(terms.fixture.homeTeam.id, "home team ID"), homeTeam: safe(terms.fixture.homeTeam.name, "home team"), awayTeamId: safe(terms.fixture.awayTeam.id, "away team ID"), awayTeam: safe(terms.fixture.awayTeam.name, "away team"), kickoffUtc: terms.fixture.kickoffUtc, creatorAddress, opponentAddress, creatorSelection: terms.creatorSelection, opponentSelection: terms.opponentSelection, unselectedOutcome: terms.unselectedOutcome, stakeMist: terms.stakeMist, invitationLifetimeMinutes: terms.invitationLifetimeMinutes, voidRule: terms.voidRule };
}

export function canonicalizeFootballDuelCore(input: FootballDuelCoreTerms) { const core = validatedCore(input); return [core.version, `provider=${core.provider}`, `competitionCode=${core.competitionCode}`, `competitionName=${core.competitionName}`, `fixtureId=${core.fixtureId}`, `homeTeamId=${core.homeTeamId}`, `homeTeam=${core.homeTeam}`, `awayTeamId=${core.awayTeamId}`, `awayTeam=${core.awayTeam}`, `kickoffUtc=${core.kickoffUtc}`, `creatorAddress=${core.creatorAddress}`, `opponentAddress=${core.opponentAddress}`, "market=1X2", `creatorSelection=${core.creatorSelection}`, `opponentSelection=${core.opponentSelection}`, `unselectedOutcome=${core.unselectedOutcome}`, `stakeMist=${core.stakeMist}`, `invitationLifetimeMinutes=${core.invitationLifetimeMinutes}`, `voidRule=${core.voidRule}`, ""].join("\n"); }
function hashUtf8(value: string) { return Array.from(sha256(new TextEncoder().encode(value)), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
export function hashFootballDuelCore(core: FootballDuelCoreTerms) { return hashUtf8(canonicalizeFootballDuelCore(core)); }

/** The exact UTF-8 preimage whose SHA-256 bytes become Move `vector<u8>` at future creation. */
export function canonicalizeFootballDuelChallenge(terms: FootballDuelChallengeTerms) {
  const core = canonicalizeFootballDuelCore(terms).trimEnd().split("\n"); const invitationExpiry = iso(terms.invitationExpiresAtUtc, "invitationExpiresAtUtc"); const funding = iso(terms.fundingDeadlineUtc, "fundingDeadlineUtc"); const outcome = iso(terms.outcomeDeadlineUtc, "outcomeDeadlineUtc");
  if (!(invitationExpiry < funding && funding < outcome)) throw new Error("Invitation, funding, and outcome deadlines must strictly increase.");
  return ["stakemate.challenge-terms.v1", ...core, `invitationExpiresAtUtc=${terms.invitationExpiresAtUtc}`, `fundingDeadlineUtc=${terms.fundingDeadlineUtc}`, `outcomeDeadlineUtc=${terms.outcomeDeadlineUtc}`, `outcomeAuthority=${address(terms.outcomeAuthority)}`, ""].join("\n");
}
export function hashFootballDuelChallenge(terms: FootballDuelChallengeTerms) { return `0x${hashUtf8(canonicalizeFootballDuelChallenge(terms))}`; }
export function moveHashBytes(hash: string) { if (!/^0x[0-9a-f]{64}$/iu.test(hash)) throw new Error("Move terms hash must be 0x-prefixed 32-byte SHA-256."); return Uint8Array.from(hash.slice(2).match(/.{2}/g)!.map((part) => Number.parseInt(part, 16))); }
