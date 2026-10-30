-- Milestone 7.17. Apply only after reviewed 0001 and 0002 on an approved database.
-- This migration is intentionally non-idempotent. It does not backfill legacy rows:
-- an absent canonical preimage cannot be reconstructed honestly.

ALTER TABLE stakemate_invitations
  ADD COLUMN canonical_core_version text,
  ADD COLUMN canonical_core_bytes text,
  ADD COLUMN canonical_core_hash char(64),
  ADD COLUMN fixture_provider text,
  ADD COLUMN fixture_id text,
  ADD COLUMN competition_code text,
  ADD COLUMN kickoff_at timestamptz,
  ADD COLUMN creator_selection text,
  ADD COLUMN opponent_selection text,
  ADD COLUMN unselected_outcome text,
  ADD COLUMN stake_mist text,
  ADD COLUMN accepted_challenge_version text,
  ADD COLUMN accepted_challenge_bytes text,
  ADD COLUMN accepted_challenge_hash char(66),
  ADD COLUMN accepted_outcome_authority text;

ALTER TABLE stakemate_invitations
  ADD CONSTRAINT stakemate_invitations_core_commitment_complete CHECK (
    (canonical_core_version IS NULL AND canonical_core_bytes IS NULL AND canonical_core_hash IS NULL
      AND fixture_provider IS NULL AND fixture_id IS NULL AND competition_code IS NULL AND kickoff_at IS NULL
      AND creator_selection IS NULL AND opponent_selection IS NULL AND unselected_outcome IS NULL AND stake_mist IS NULL)
    OR
    (canonical_core_version = 'stakemate.football-1x2-duel.v2'
      AND canonical_core_bytes IS NOT NULL AND canonical_core_hash IS NOT NULL AND canonical_core_hash ~ '^[0-9a-f]{64}$'
      AND canonical_core_hash = duel_terms_hash
      AND fixture_provider = 'football-data.org/v4' AND fixture_id IS NOT NULL AND fixture_id <> ''
      AND competition_code IS NOT NULL AND competition_code IN ('PL', 'PD', 'CL') AND kickoff_at IS NOT NULL
      AND creator_selection IS NOT NULL AND creator_selection IN ('home_win', 'draw', 'away_win')
      AND opponent_selection IS NOT NULL AND opponent_selection IN ('home_win', 'draw', 'away_win')
      AND unselected_outcome IS NOT NULL AND unselected_outcome IN ('home_win', 'draw', 'away_win')
      AND creator_selection <> opponent_selection AND creator_selection <> unselected_outcome AND opponent_selection <> unselected_outcome
      AND stake_mist IS NOT NULL AND stake_mist ~ '^[1-9][0-9]*$')
  ),
  ADD CONSTRAINT stakemate_invitations_accepted_commitment_complete CHECK (
    (accepted_challenge_version IS NULL AND accepted_challenge_bytes IS NULL AND accepted_challenge_hash IS NULL AND accepted_outcome_authority IS NULL)
    OR
    (status = 'accepted' AND accepted_challenge_version = 'stakemate.challenge-terms.v1'
      AND accepted_challenge_bytes IS NOT NULL AND accepted_challenge_hash IS NOT NULL AND accepted_challenge_hash ~ '^0x[0-9a-f]{64}$'
      AND accepted_outcome_authority IS NOT NULL AND accepted_outcome_authority ~ '^0x[0-9a-f]{64}$'
      AND accepted_wallet_address IS NOT NULL AND recipient_wallet_address IS NOT NULL AND accepted_wallet_address = recipient_wallet_address AND responded_at IS NOT NULL AND funding_deadline_at IS NOT NULL
      AND funding_deadline_at > responded_at AND funding_deadline_at < outcome_deadline_at)
  ),
  ADD CONSTRAINT stakemate_invitations_accepted_status_has_commitment CHECK (
    -- Historical accepted rows may lack evidence and remain read-only legacy rows.
    -- The trigger below prevents a pending legacy row from newly becoming accepted.
    status <> 'accepted' OR canonical_core_hash IS NULL OR accepted_challenge_hash IS NOT NULL
  );

CREATE INDEX stakemate_invitations_fixture_pending_idx ON stakemate_invitations (fixture_provider, fixture_id, status, expires_at) WHERE canonical_core_hash IS NOT NULL;
CREATE UNIQUE INDEX stakemate_invitations_accepted_challenge_hash_idx ON stakemate_invitations (accepted_challenge_hash) WHERE accepted_challenge_hash IS NOT NULL;

-- Store only a server-side hash of the client idempotency key and request fingerprint.
CREATE TABLE stakemate_invitation_idempotency (
  actor_wallet_address text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'accept', 'reject', 'cancel')),
  key_hash char(64) NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  invitation_id uuid REFERENCES stakemate_invitations(id) ON DELETE RESTRICT,
  response_status text NOT NULL CHECK (response_status IN ('completed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (actor_wallet_address, operation, key_hash)
);
CREATE INDEX stakemate_invitation_idempotency_invitation_idx ON stakemate_invitation_idempotency (invitation_id, created_at DESC);
-- Application tables are server-only. The owner role used by the server bypasses
-- non-FORCE RLS; untrusted/browser roles have neither policies nor grants.
ALTER TABLE stakemate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_auth_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_invitation_idempotency ENABLE ROW LEVEL SECURITY;

-- Evidence is write-once. Only pending rows may transition, and acceptance must attach
-- both commitments in the same transaction. Legacy rows stay readable but cannot accept.
CREATE FUNCTION stakemate_guard_invitation_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> NEW.status AND NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected', 'cancelled', 'expired')) THEN RAISE EXCEPTION 'invalid invitation status transition'; END IF;
    IF OLD.canonical_core_hash IS NOT NULL AND ROW(NEW.canonical_core_version, NEW.canonical_core_bytes, NEW.canonical_core_hash, NEW.fixture_provider, NEW.fixture_id, NEW.competition_code, NEW.kickoff_at, NEW.creator_selection, NEW.opponent_selection, NEW.unselected_outcome, NEW.stake_mist, NEW.creator_wallet_address, NEW.recipient_wallet_address, NEW.expires_at, NEW.outcome_deadline_at) IS DISTINCT FROM ROW(OLD.canonical_core_version, OLD.canonical_core_bytes, OLD.canonical_core_hash, OLD.fixture_provider, OLD.fixture_id, OLD.competition_code, OLD.kickoff_at, OLD.creator_selection, OLD.opponent_selection, OLD.unselected_outcome, OLD.stake_mist, OLD.creator_wallet_address, OLD.recipient_wallet_address, OLD.expires_at, OLD.outcome_deadline_at) THEN RAISE EXCEPTION 'invitation core canonical evidence is immutable'; END IF;
    IF OLD.status = 'accepted' AND ROW(NEW.accepted_challenge_version, NEW.accepted_challenge_bytes, NEW.accepted_challenge_hash, NEW.accepted_outcome_authority, NEW.accepted_wallet_address, NEW.funding_deadline_at) IS DISTINCT FROM ROW(OLD.accepted_challenge_version, OLD.accepted_challenge_bytes, OLD.accepted_challenge_hash, OLD.accepted_outcome_authority, OLD.accepted_wallet_address, OLD.funding_deadline_at) THEN RAISE EXCEPTION 'accepted invitation canonical evidence is immutable'; END IF;
    IF OLD.status = 'pending' AND NEW.status = 'accepted' AND (NEW.canonical_core_hash IS NULL OR NEW.accepted_challenge_hash IS NULL) THEN RAISE EXCEPTION 'accepted invitation requires canonical commitments'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stakemate_guard_invitation_commitment_trigger BEFORE UPDATE ON stakemate_invitations FOR EACH ROW EXECUTE FUNCTION stakemate_guard_invitation_commitment();
