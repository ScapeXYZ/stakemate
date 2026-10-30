import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { FootballDuelCoreTerms } from "@/lib/football-duel-terms";

/** Server-only policy inputs required in addition to the two lifecycle gates. */
export function acceptedOutcomeAuthority() {
  const value = process.env.STAKEMATE_SETTLEMENT_OUTCOME_AUTHORITY;
  if (!value) throw new Error("INVITATION_POLICY_NOT_CONFIGURED");
  return normalizeSuiAddress(value).toLowerCase();
}

/** The operator, never a browser, chooses the bounded post-kickoff outcome window. */
export function outcomeDeadlineForCore(core: FootballDuelCoreTerms) {
  const configured = process.env.STAKEMATE_INVITATION_OUTCOME_WINDOW_HOURS;
  if (!configured || !/^\d+$/u.test(configured)) throw new Error("INVITATION_POLICY_NOT_CONFIGURED");
  const hours = Number(configured);
  if (!Number.isSafeInteger(hours) || hours < 24 || hours > 168) throw new Error("INVITATION_POLICY_NOT_CONFIGURED");
  return new Date(Date.parse(core.kickoffUtc) + hours * 60 * 60_000).toISOString();
}
