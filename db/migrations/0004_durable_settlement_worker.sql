-- Milestone 7.22. Apply only after approved 0001, 0002 and 0003.
-- Result evidence and decisions are append-only. Settlement jobs are mutable only
-- as a durable operational queue; they never contain signing material.

CREATE TABLE stakemate_result_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES stakemate_invitations(id) ON DELETE RESTRICT,
  source_id text NOT NULL CHECK (source_id <> ''),
  source_kind text NOT NULL CHECK (source_kind IN ('provider', 'licensed_secondary')),
  fixture_provider text NOT NULL CHECK (fixture_provider = 'football-data.org/v4'),
  fixture_id text NOT NULL CHECK (fixture_id <> ''),
  competition_code text NOT NULL CHECK (competition_code IN ('PL', 'PD', 'CL')),
  kickoff_at timestamptz NOT NULL,
  match_state text NOT NULL CHECK (match_state IN ('final', 'postponed', 'abandoned', 'cancelled', 'suspended', 'rescheduled', 'unavailable')),
  home_score_regulation integer CHECK (home_score_regulation IS NULL OR home_score_regulation >= 0),
  away_score_regulation integer CHECK (away_score_regulation IS NULL OR away_score_regulation >= 0),
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  supersedes_evidence_id uuid REFERENCES stakemate_result_evidence(id) ON DELETE RESTRICT,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((match_state = 'final' AND home_score_regulation IS NOT NULL AND away_score_regulation IS NOT NULL)
    OR (match_state <> 'final' AND home_score_regulation IS NULL AND away_score_regulation IS NULL)),
  UNIQUE (invitation_id, source_id, evidence_hash)
);
CREATE INDEX stakemate_result_evidence_invitation_idx ON stakemate_result_evidence (invitation_id, recorded_at DESC);
CREATE INDEX stakemate_result_evidence_fixture_idx ON stakemate_result_evidence (fixture_provider, fixture_id, kickoff_at);

CREATE TABLE stakemate_settlement_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES stakemate_invitations(id) ON DELETE RESTRICT,
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  verification_state text NOT NULL CHECK (verification_state IN ('verified', 'void_pending', 'disputed', 'awaiting_correction', 'pending_evidence', 'unavailable')),
  result_outcome text CHECK (result_outcome IS NULL OR result_outcome IN ('home_win', 'draw', 'away_win')),
  expected_move_outcome smallint CHECK (expected_move_outcome IS NULL OR expected_move_outcome IN (0, 1, 2)),
  correction_window_ends_at timestamptz NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rationale text NOT NULL CHECK (rationale <> ''),
  decision_hash char(64) NOT NULL UNIQUE CHECK (decision_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((verification_state = 'verified' AND result_outcome IS NOT NULL AND expected_move_outcome IS NOT NULL)
    OR (verification_state = 'void_pending' AND result_outcome IS NULL AND expected_move_outcome = 0)
    OR (verification_state NOT IN ('verified', 'void_pending') AND result_outcome IS NULL AND expected_move_outcome IS NULL)),
  UNIQUE (invitation_id, evidence_hash, decision_hash)
);
CREATE INDEX stakemate_settlement_decisions_invitation_idx ON stakemate_settlement_decisions (invitation_id, decided_at DESC);

CREATE TABLE stakemate_settlement_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  emergency_paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((emergency_paused AND pause_reason IS NOT NULL AND pause_reason <> '') OR NOT emergency_paused)
);
INSERT INTO stakemate_settlement_control (singleton) VALUES (true);

CREATE TABLE stakemate_settlement_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL UNIQUE REFERENCES stakemate_invitations(id) ON DELETE RESTRICT,
  decision_id uuid NOT NULL REFERENCES stakemate_settlement_decisions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'prepared', 'broadcast_pending', 'confirmed', 'retry_wait', 'failed', 'paused', 'disputed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  run_after timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key char(64) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  expected_move_outcome smallint NOT NULL CHECK (expected_move_outcome IN (0, 1, 2)),
  move_challenge_id text NOT NULL CHECK (move_challenge_id ~ '^0x[0-9a-f]{64}$'),
  funding_confirmed_at timestamptz NOT NULL,
  transaction_digest text,
  confirmation_status text NOT NULL DEFAULT 'unknown' CHECK (confirmation_status IN ('unknown', 'not_found', 'pending', 'confirmed', 'failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR status <> 'leased'),
  CHECK ((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX stakemate_settlement_jobs_claim_idx ON stakemate_settlement_jobs (status, run_after, lease_expires_at);
CREATE INDEX stakemate_settlement_jobs_decision_idx ON stakemate_settlement_jobs (decision_id);

CREATE TABLE stakemate_settlement_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES stakemate_settlement_jobs(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type <> ''),
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_id, event_hash)
);
CREATE INDEX stakemate_settlement_audit_job_idx ON stakemate_settlement_audit (job_id, recorded_at);

CREATE FUNCTION stakemate_reject_settlement_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'settlement evidence and decisions are append-only';
END;
$$;
CREATE TRIGGER stakemate_result_evidence_append_only BEFORE UPDATE OR DELETE ON stakemate_result_evidence FOR EACH ROW EXECUTE FUNCTION stakemate_reject_settlement_history_mutation();
CREATE TRIGGER stakemate_settlement_decisions_append_only BEFORE UPDATE OR DELETE ON stakemate_settlement_decisions FOR EACH ROW EXECUTE FUNCTION stakemate_reject_settlement_history_mutation();
CREATE TRIGGER stakemate_settlement_audit_append_only BEFORE UPDATE OR DELETE ON stakemate_settlement_audit FOR EACH ROW EXECUTE FUNCTION stakemate_reject_settlement_history_mutation();

ALTER TABLE stakemate_result_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_settlement_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_settlement_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_settlement_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_settlement_audit ENABLE ROW LEVEL SECURITY;
