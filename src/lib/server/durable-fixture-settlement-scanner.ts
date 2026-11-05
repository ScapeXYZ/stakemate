import { createHash } from "node:crypto";
import type { FootballDuelChallengeTerms } from "@/lib/football-duel-terms";
import type { EscrowChallenge } from "@/lib/escrow-discovery";
import { settlementOutcome, type ResultCommitment } from "@/lib/server/football-result-verification";
import { verifyCommittedFootballFixture } from "@/lib/server/football-verification-service";
import type { DurableSettlementWorker } from "@/lib/server/durable-settlement-worker";

export type FundedRegisteredDuel = {
  invitationId: string;
  challengeId: string;
  terms: FootballDuelChallengeTerms;
  challenge: EscrowChallenge;
  fundingTransactionDigest: string;
  fundingConfirmedAt: string;
};

/** Persistence is deliberately injected: provider observations are append-only,
 * while the first matching-final window is durable and never reset by polling. */
export type FixtureScannerStore = {
  fundedRegistrations(): Promise<readonly FundedRegisteredDuel[]>;
  recordObservation(input: { invitationId: string; evidenceHash: string; evidence: unknown }): Promise<void>;
  correctionWindow(input: { invitationId: string; scoreFingerprint: string; proposedEndsAt: string }): Promise<string>;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const commitment = (terms: FootballDuelChallengeTerms): ResultCommitment => ({ fixtureId: terms.fixtureId, competitionCode: terms.competitionCode, kickoffUtc: terms.kickoffUtc, creatorSelection: terms.creatorSelection, opponentSelection: terms.opponentSelection, unselectedOutcome: terms.unselectedOutcome });

/**
 * One bounded scanner pass. It has no signer, no chain writer, and no automatic
 * retry loop. Only fresh on-chain-funded registrations supplied by the scanner
 * store are considered; contradictory/unavailable results never reach the queue.
 */
export class DurableFixtureSettlementScanner {
  constructor(
    private readonly store: FixtureScannerStore,
    private readonly queue: Pick<DurableSettlementWorker, "enqueueVerified">,
    private readonly verify = verifyCommittedFootballFixture,
    private readonly now = () => new Date(),
  ) {}

  async scanOnce() {
    let observed = 0; let enqueued = 0; let held = 0;
    for (const duel of await this.store.fundedRegistrations()) {
      // Never use a DB funding flag as proof. The store must have obtained this
      // object from a confirmed Testnet funding event and fresh object read.
      if (duel.challenge.id.toLowerCase() !== duel.challengeId.toLowerCase() || duel.challenge.state !== 1 || duel.challenge.outcomeAuthority.toLowerCase() !== duel.terms.outcomeAuthority.toLowerCase()) { held += 1; continue; }
      const result = await this.verify({ ...commitment(duel.terms), homeTeam: duel.terms.homeTeam, awayTeam: duel.terms.awayTeam });
      observed += 1;
      await this.store.recordObservation({ invitationId: duel.invitationId, evidenceHash: result.verification.evidenceHash, evidence: result.evidence });
      const verification = result.verification;
      if (verification.state !== "awaiting_correction" && verification.state !== "verified") { held += 1; continue; }
      if (!verification.outcome || !verification.finalizeAfterUtc) { held += 1; continue; }
      const windowEndsAt = await this.store.correctionWindow({ invitationId: duel.invitationId, scoreFingerprint: hash(result.evidence.map((item) => [item.sourceId, item.regulationHomeScore, item.regulationAwayScore])), proposedEndsAt: verification.finalizeAfterUtc });
      if (Date.parse(windowEndsAt) > this.now().getTime()) { held += 1; continue; }
      const outcome = settlementOutcome(commitment(duel.terms), { ...verification, state: "verified", finalizeAfterUtc: windowEndsAt });
      if (outcome === null) { held += 1; continue; }
      const decisionHash = hash({ challengeId: duel.challengeId, evidenceHash: verification.evidenceHash, outcome, windowEndsAt });
      await this.queue.enqueueVerified({ invitationId: duel.invitationId, evidenceHash: verification.evidenceHash, verificationState: "verified", resultOutcome: verification.outcome, expectedMoveOutcome: outcome, correctionWindowEndsAt: windowEndsAt, rationale: "Two independent authoritative final scores agree and the persisted correction window elapsed.", decisionHash, moveChallengeId: duel.challengeId, fundingConfirmedAt: duel.fundingConfirmedAt, idempotencyKey: hash({ invitationId: duel.invitationId, challengeId: duel.challengeId, decisionHash }) });
      enqueued += 1;
    }
    return { observed, enqueued, held };
  }
}
