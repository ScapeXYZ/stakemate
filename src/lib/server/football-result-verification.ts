import { createHash } from "node:crypto";
import type { FootballCompetition } from "@/lib/server/football-data";
import type { OneXTwoSelection } from "@/lib/duel-draft";

export type ResultCommitment = { fixtureId: string; competitionCode: FootballCompetition; kickoffUtc: string; creatorSelection: OneXTwoSelection; opponentSelection: OneXTwoSelection; unselectedOutcome: OneXTwoSelection };
export type EvidenceStatus = "final" | "postponed" | "abandoned" | "cancelled" | "suspended" | "rescheduled" | "corrected" | "unavailable";
export type FootballResultEvidence = { sourceId: string; sourceKind: "provider" | "licensed_secondary"; fixtureId: string; competitionCode: FootballCompetition; kickoffUtc: string; status: EvidenceStatus; regulationHomeScore: number | null; regulationAwayScore: number | null; observedAtUtc: string; sourceRetrievedAtUtc: string; provenance: string };
export type VerificationState = "pending_evidence" | "awaiting_correction" | "verified" | "void_pending" | "disputed" | "unavailable";
export type ResultVerification = { state: VerificationState; outcome: OneXTwoSelection | null; evidenceHash: string; evidence: readonly FootballResultEvidence[]; finalizeAfterUtc: string | null; reason: string };
export const defaultCorrectionWindowMs = 60 * 60_000;
const iso = (value: string) => { const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error("Evidence timestamps must be exact UTC."); return parsed; };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const outcomes = (home: number, away: number): OneXTwoSelection => home > away ? "home_win" : home < away ? "away_win" : "draw";

function bound(commitment: ResultCommitment, evidence: FootballResultEvidence) { return evidence.fixtureId === commitment.fixtureId && evidence.competitionCode === commitment.competitionCode && evidence.kickoffUtc === commitment.kickoffUtc; }
function result(state: VerificationState, evidence: readonly FootballResultEvidence[], reason: string, outcome: OneXTwoSelection | null = null, finalizeAfterUtc: string | null = null): ResultVerification { return { state, outcome, evidence: [...evidence], evidenceHash: hash([...evidence].map((item) => ({ ...item })).sort((a, b) => a.sourceId.localeCompare(b.sourceId))), finalizeAfterUtc, reason }; }

/** Pure server-side state machine. It does not fetch, persist, sign, or broadcast. */
export function verifyFootballResult(commitment: ResultCommitment, evidence: readonly FootballResultEvidence[], now = new Date(), correctionWindowMs = defaultCorrectionWindowMs): ResultVerification {
  if (!/^[0-9]+$/u.test(commitment.fixtureId) || !Number.isFinite(iso(commitment.kickoffUtc))) throw new Error("Invalid immutable fixture commitment.");
  if (!Number.isInteger(correctionWindowMs) || correctionWindowMs < 15 * 60_000 || correctionWindowMs > 7 * 24 * 60 * 60_000) throw new Error("Correction window must be between 15 minutes and seven days.");
  if (new Set([commitment.creatorSelection, commitment.opponentSelection, commitment.unselectedOutcome]).size !== 3) throw new Error("Committed 1X2 selections are invalid.");
  if (!evidence.length) return result("pending_evidence", evidence, "No result evidence is available.");
  if (evidence.some((item) => !bound(commitment, item))) return result("disputed", evidence, "Evidence does not match the immutable fixture, competition, and kickoff.");
  if (new Set(evidence.map((item) => item.sourceId)).size !== evidence.length) return result("disputed", evidence, "Repeated requests to one source are not independent confirmation.");
  for (const item of evidence) { iso(item.observedAtUtc); iso(item.sourceRetrievedAtUtc); if (!item.sourceId || !item.provenance) return result("disputed", evidence, "Evidence provenance is incomplete."); }
  if (evidence.some((item) => item.status === "unavailable")) return result("unavailable", evidence, "A required result source is unavailable; no automatic finalization.");
  if (evidence.some((item) => ["postponed", "suspended", "rescheduled", "corrected"].includes(item.status))) return result("disputed", evidence, "Fixture timing or reported result changed; manual dispute review is required.");
  if (evidence.some((item) => ["abandoned", "cancelled"].includes(item.status))) return result("void_pending", evidence, "Fixture was abandoned or cancelled; hold for correction/dispute review before a void refund.");
  const finals = evidence.filter((item) => item.status === "final" && Number.isInteger(item.regulationHomeScore) && item.regulationHomeScore! >= 0 && Number.isInteger(item.regulationAwayScore) && item.regulationAwayScore! >= 0);
  if (finals.length < 2 || new Set(finals.map((item) => item.sourceKind)).size < 2) return result("pending_evidence", evidence, "Two independent final-result source kinds are required.");
  const scores = new Set(finals.map((item) => `${item.regulationHomeScore}:${item.regulationAwayScore}`));
  if (scores.size !== 1) return result("disputed", evidence, "Independent regulation-time scores conflict.");
  const latest = Math.max(...finals.map((item) => iso(item.observedAtUtc))); const finalizeAt = latest + correctionWindowMs; const outcome = outcomes(finals[0].regulationHomeScore!, finals[0].regulationAwayScore!);
  return now.getTime() < finalizeAt ? result("awaiting_correction", evidence, "Independent final result awaits the correction window.", outcome, new Date(finalizeAt).toISOString()) : result("verified", evidence, "Independent regulation-time result confirmed after correction window.", outcome, new Date(finalizeAt).toISOString());
}

/** Deployed Move outcome codes: 1 creator, 2 opponent, 0 void/refund. */
export function settlementOutcome(commitment: ResultCommitment, verification: ResultVerification): 0 | 1 | 2 | null {
  if (verification.state !== "verified" || !verification.outcome) return null;
  if (verification.outcome === commitment.creatorSelection) return 1;
  if (verification.outcome === commitment.opponentSelection) return 2;
  if (verification.outcome === commitment.unselectedOutcome) return 0;
  return null;
}
