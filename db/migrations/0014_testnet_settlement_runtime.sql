-- Additive runtime state for the Testnet-only automatic settlement scanner.
-- Apply after 0012 and 0013. No key material is ever stored here.

CREATE TABLE stakemate_testnet_duel_links (
  challenge_id text PRIMARY KEY REFERENCES stakemate_testnet_duel_registrations(challenge_id) ON DELETE RESTRICT,
  invitation_id uuid NOT NULL UNIQUE REFERENCES stakemate_invitations(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE stakemate_testnet_correction_windows (
  invitation_id uuid PRIMARY KEY REFERENCES stakemate_invitations(id) ON DELETE RESTRICT,
  score_fingerprint char(64) NOT NULL CHECK (score_fingerprint ~ '^[0-9a-f]{64}$'),
  starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ends_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ends_at > starts_at)
);

ALTER TABLE stakemate_testnet_duel_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_testnet_correction_windows ENABLE ROW LEVEL SECURITY;
