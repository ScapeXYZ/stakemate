-- StakeMate invitation storage. Review and apply explicitly; this migration makes no changes
-- outside its own tables. It is transaction-pooler compatible (no session state/functions).
CREATE TABLE stakemate_profiles (
  id uuid PRIMARY KEY,
  wallet_address text NOT NULL UNIQUE,
  username text NOT NULL,
  username_normalized text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT stakemate_profiles_username_format CHECK (username_normalized ~ '^[a-z0-9_]{3,24}$')
);

CREATE TABLE stakemate_auth_nonces (
  nonce text PRIMARY KEY,
  wallet_address text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX stakemate_auth_nonces_expiry_idx ON stakemate_auth_nonces (expires_at);

CREATE TABLE stakemate_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  wallet_address text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX stakemate_sessions_active_idx ON stakemate_sessions (token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE stakemate_invitations (
  id uuid PRIMARY KEY,
  creator_profile_id uuid NOT NULL REFERENCES stakemate_profiles(id) ON DELETE RESTRICT,
  recipient_profile_id uuid NOT NULL REFERENCES stakemate_profiles(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  terms_canonical text NOT NULL,
  terms_hash char(64) NOT NULL CHECK (terms_hash ~ '^[0-9a-f]{64}$'),
  terms_json jsonb NOT NULL,
  funding_status text NOT NULL CHECK (funding_status = 'not_funded'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT stakemate_invitations_participants_differ CHECK (creator_profile_id <> recipient_profile_id),
  CONSTRAINT stakemate_invitations_expiry_after_create CHECK (expires_at > created_at)
);
CREATE INDEX stakemate_invitations_recipient_idx ON stakemate_invitations (recipient_profile_id, status, expires_at);
CREATE INDEX stakemate_invitations_creator_idx ON stakemate_invitations (creator_profile_id, status, expires_at);
