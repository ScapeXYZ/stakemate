-- Local-only authorization-code lifecycle foundation. No route issues or exchanges codes.
CREATE TABLE stakemate_remote_mcp_authorization_codes (
  id uuid PRIMARY KEY,
  authorization_id uuid NOT NULL REFERENCES stakemate_remote_mcp_authorizations(id) ON DELETE RESTRICT,
  oauth_client_id text NOT NULL CHECK (oauth_client_id <> ''),
  redirect_uri text NOT NULL CHECK (redirect_uri <> ''),
  profile_id uuid NOT NULL REFERENCES stakemate_profiles(id) ON DELETE RESTRICT,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{64}$'),
  approved_scopes text[] NOT NULL CHECK (cardinality(approved_scopes) > 0 AND approved_scopes <@ ARRAY['duels:prepare', 'credibility:read', 'invitations:read']::text[]),
  code_hash char(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  pkce_code_challenge text NOT NULL CHECK (pkce_code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  pkce_code_challenge_method text NOT NULL CHECK (pkce_code_challenge_method = 'S256'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);
CREATE INDEX stakemate_remote_mcp_authorization_codes_redeem_idx ON stakemate_remote_mcp_authorization_codes (code_hash, expires_at) WHERE consumed_at IS NULL;

CREATE FUNCTION stakemate_guard_remote_mcp_authorization_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM stakemate_remote_mcp_authorizations a
      JOIN stakemate_profiles p ON p.id = a.profile_id AND p.wallet_address = a.wallet_address
      WHERE a.id = NEW.authorization_id
        AND a.oauth_client_id = NEW.oauth_client_id
        AND a.profile_id = NEW.profile_id
        AND a.wallet_address = NEW.wallet_address
        AND NEW.approved_scopes <@ a.approved_scopes
        AND a.revoked_at IS NULL
        AND a.expires_at >= NEW.expires_at
    ) THEN RAISE EXCEPTION 'remote MCP authorization code binding mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.authorization_id, NEW.oauth_client_id, NEW.redirect_uri, NEW.profile_id, NEW.wallet_address, NEW.approved_scopes, NEW.code_hash, NEW.pkce_code_challenge, NEW.pkce_code_challenge_method, NEW.issued_at, NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.authorization_id, OLD.oauth_client_id, OLD.redirect_uri, OLD.profile_id, OLD.wallet_address, OLD.approved_scopes, OLD.code_hash, OLD.pkce_code_challenge, OLD.pkce_code_challenge_method, OLD.issued_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'remote MCP authorization code is immutable';
  END IF;
  IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN RAISE EXCEPTION 'remote MCP authorization code consumption is single use'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stakemate_guard_remote_mcp_authorization_code_trigger BEFORE INSERT OR UPDATE ON stakemate_remote_mcp_authorization_codes FOR EACH ROW EXECUTE FUNCTION stakemate_guard_remote_mcp_authorization_code();

ALTER TABLE stakemate_remote_mcp_authorization_codes ENABLE ROW LEVEL SECURITY;
