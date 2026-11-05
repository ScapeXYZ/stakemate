import "server-only";

import { createHash } from "node:crypto";
import postgres from "postgres";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { getEscrowChallenge, type EscrowChallenge } from "@/lib/escrow-discovery";
import type { FootballDuelChallengeTerms } from "@/lib/football-duel-terms";
import { postgresSslForDatabaseUrl } from "@/lib/server/postgres-connection-security";
import type { FixtureScannerStore, FundedRegisteredDuel } from "@/lib/server/durable-fixture-settlement-scanner";
import type { FootballResultEvidence } from "@/lib/server/football-result-verification";

type ChallengeReader = Pick<SuiGrpcClient, "getObject" | "listEvents">;
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const utc = (value: unknown) => new Date(value as Date).toISOString();

/** PostgreSQL source of truth for a bounded scanner pass.  Attestations are
 * written only by server-side Sui funding-event verification, and every row is
 * re-read from Testnet before a provider is contacted. */
export class PostgresFixtureScannerStore implements FixtureScannerStore {
  private readonly sql: postgres.Sql;
  constructor(databaseUrl: string, private readonly reader: ChallengeReader = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" })) {
    this.sql = postgres(databaseUrl, { prepare: false, max: 3, ssl: postgresSslForDatabaseUrl(databaseUrl), connect_timeout: 10, idle_timeout: 20 });
  }
  async close() { await this.sql.end({ timeout: 5 }); }

  async fundedRegistrations(): Promise<readonly FundedRegisteredDuel[]> {
    const rows = await this.sql`
      select r.challenge_id, r.canonical_terms, a.funding_transaction_digest, a.attested_at,
             l.invitation_id
      from stakemate_testnet_duel_registrations r
      join stakemate_testnet_duel_links l on l.challenge_id = r.challenge_id
      join stakemate_testnet_challenge_attestations a on a.challenge_id = r.challenge_id
      left join stakemate_settlement_jobs j on j.invitation_id = l.invitation_id
      where j.id is null or j.status not in ('confirmed', 'failed')
      order by a.attested_at asc
      limit 25`;
    const result: FundedRegisteredDuel[] = [];
    for (const item of rows) {
      let terms: FootballDuelChallengeTerms;
      let challenge: EscrowChallenge;
      try {
        terms = JSON.parse(String(item.canonical_terms)) as FootballDuelChallengeTerms;
        challenge = await getEscrowChallenge(this.reader, String(item.challenge_id));
      } catch {
        // An RPC failure or malformed historical record is a hold, never an
        // invitation to settle from stale database data.
        continue;
      }
      result.push({ invitationId: String(item.invitation_id), challengeId: String(item.challenge_id), terms, challenge, fundingTransactionDigest: String(item.funding_transaction_digest), fundingConfirmedAt: utc(item.attested_at) });
    }
    return result;
  }

  async recordObservation(input: { invitationId: string; evidenceHash: string; evidence: unknown }): Promise<void> {
    if (!Array.isArray(input.evidence)) throw new Error("INVALID_RESULT_EVIDENCE");
    const evidence = input.evidence as unknown[];
    await this.sql.begin(async (tx) => {
      for (const raw of evidence) {
        const e = raw as FootballResultEvidence;
        if (!e || typeof e !== "object" || !e.sourceId || !e.sourceKind || !e.fixtureId || !e.competitionCode || !e.kickoffUtc || !e.status || !e.observedAtUtc || !e.sourceRetrievedAtUtc || !e.provenance) throw new Error("INVALID_RESULT_EVIDENCE");
        const evidenceHash = sha256({ sourceId: e.sourceId, sourceKind: e.sourceKind, fixtureId: e.fixtureId, competitionCode: e.competitionCode, kickoffUtc: e.kickoffUtc, status: e.status, home: e.regulationHomeScore, away: e.regulationAwayScore, observedAtUtc: e.observedAtUtc, retrievedAtUtc: e.sourceRetrievedAtUtc, provenance: e.provenance });
        await tx`insert into stakemate_result_evidence (invitation_id, source_id, source_kind, fixture_provider, fixture_id, competition_code, kickoff_at, match_state, home_score_regulation, away_score_regulation, observed_at, retrieved_at, provenance, evidence_hash)
          values (${input.invitationId}, ${e.sourceId}, ${e.sourceKind}, 'football-data.org/v4', ${e.fixtureId}, ${e.competitionCode}, ${e.kickoffUtc}, ${e.status === 'final' ? 'final' : e.status === 'postponed' ? 'postponed' : e.status === 'abandoned' ? 'abandoned' : e.status === 'cancelled' ? 'cancelled' : e.status === 'suspended' ? 'suspended' : e.status === 'rescheduled' || e.status === 'corrected' ? 'rescheduled' : 'unavailable'}, ${e.status === 'final' ? e.regulationHomeScore : null}, ${e.status === 'final' ? e.regulationAwayScore : null}, ${e.observedAtUtc}, ${e.sourceRetrievedAtUtc}, ${tx.json({ provenance: e.provenance, verificationEvidenceHash: input.evidenceHash })}, ${evidenceHash}) on conflict (invitation_id, source_id, evidence_hash) do nothing`;
      }
    });
  }

  async correctionWindow(input: { invitationId: string; scoreFingerprint: string; proposedEndsAt: string }): Promise<string> {
    if (!/^[0-9a-f]{64}$/u.test(input.scoreFingerprint) || !Number.isFinite(Date.parse(input.proposedEndsAt))) throw new Error("INVALID_CORRECTION_WINDOW");
    return this.sql.begin(async (tx) => {
      const [stored] = await tx`select score_fingerprint, ends_at from stakemate_testnet_correction_windows where invitation_id = ${input.invitationId} for update`;
      if (stored && String(stored.score_fingerprint) === input.scoreFingerprint) return utc(stored.ends_at);
      // A changed matching score starts a fresh durable window. The verifier's
      // proposed end comes from fresh observations, and cannot be shortened.
      const [saved] = await tx`insert into stakemate_testnet_correction_windows (invitation_id, score_fingerprint, starts_at, ends_at, updated_at) values (${input.invitationId}, ${input.scoreFingerprint}, clock_timestamp(), greatest(${input.proposedEndsAt}::timestamptz, clock_timestamp() + interval '15 minutes'), clock_timestamp()) on conflict (invitation_id) do update set score_fingerprint = excluded.score_fingerprint, starts_at = clock_timestamp(), ends_at = greatest(excluded.ends_at, clock_timestamp() + interval '15 minutes'), updated_at = clock_timestamp() returning ends_at`;
      return utc(saved.ends_at);
    });
  }
}
