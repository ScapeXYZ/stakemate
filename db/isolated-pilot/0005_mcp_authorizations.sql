-- LOCAL PILOT ONLY. Do not apply to Supabase or any shared database.
-- Pairing codes are stored only as SHA-256 hashes. Context HMACs and raw codes
-- never enter this table.
CREATE TABLE stakemate_mcp_authorizations (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES stakemate_sessions(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES stakemate_profiles(id) ON DELETE RESTRICT,
  wallet_address text NOT NULL,
  username text NOT NULL,
  scopes jsonb NOT NULL,
  pairing_code_hash char(64) NOT NULL UNIQUE CHECK (pairing_code_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  pairing_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  authorization_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (pairing_expires_at > requested_at),
  CHECK (authorization_expires_at > pairing_expires_at)
);
CREATE INDEX stakemate_mcp_authorizations_active_idx
  ON stakemate_mcp_authorizations (wallet_address, authorization_expires_at)
  WHERE revoked_at IS NULL;
