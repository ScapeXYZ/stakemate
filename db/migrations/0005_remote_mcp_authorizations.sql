-- Production Remote MCP authorization foundation. This migration does not
-- enable /api/mcp, create OAuth credentials, or store raw OAuth bearer tokens.
CREATE TABLE stakemate_remote_mcp_authorizations (
  id uuid PRIMARY KEY,
  oauth_subject text NOT NULL CHECK (oauth_subject <> ''),
  oauth_client_id text NOT NULL CHECK (oauth_client_id <> ''),
  profile_id uuid NOT NULL REFERENCES stakemate_profiles(id) ON DELETE RESTRICT,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{64}$'),
  approved_scopes text[] NOT NULL CHECK (cardinality(approved_scopes) > 0 AND approved_scopes <@ ARRAY['duels:prepare', 'credibility:read', 'invitations:read']::text[]),
  token_id_hash char(64) NOT NULL CHECK (token_id_hash ~ '^[0-9a-f]{64}$'),
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_authenticated_at timestamptz,
  CHECK (expires_at > authorized_at),
  UNIQUE (oauth_subject, oauth_client_id, token_id_hash)
);
CREATE INDEX stakemate_remote_mcp_authorizations_active_idx ON stakemate_remote_mcp_authorizations (oauth_subject, oauth_client_id, token_id_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX stakemate_remote_mcp_authorizations_profile_idx ON stakemate_remote_mcp_authorizations (profile_id, expires_at) WHERE revoked_at IS NULL;

CREATE FUNCTION stakemate_guard_remote_mcp_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM stakemate_profiles p WHERE p.id = NEW.profile_id AND p.wallet_address = NEW.wallet_address) THEN RAISE EXCEPTION 'remote MCP profile wallet binding mismatch'; END IF;
  ELSE
    IF ROW(NEW.oauth_subject, NEW.oauth_client_id, NEW.profile_id, NEW.wallet_address, NEW.approved_scopes, NEW.token_id_hash, NEW.authorized_at, NEW.expires_at) IS DISTINCT FROM ROW(OLD.oauth_subject, OLD.oauth_client_id, OLD.profile_id, OLD.wallet_address, OLD.approved_scopes, OLD.token_id_hash, OLD.authorized_at, OLD.expires_at) THEN RAISE EXCEPTION 'remote MCP authorization grant is immutable'; END IF;
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'remote MCP authorization revocation is immutable'; END IF;
    IF NEW.last_authenticated_at IS NOT NULL AND OLD.last_authenticated_at IS NOT NULL AND NEW.last_authenticated_at < OLD.last_authenticated_at THEN RAISE EXCEPTION 'remote MCP authentication timestamp cannot move backwards'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stakemate_guard_remote_mcp_authorization_trigger BEFORE INSERT OR UPDATE ON stakemate_remote_mcp_authorizations FOR EACH ROW EXECUTE FUNCTION stakemate_guard_remote_mcp_authorization();

ALTER TABLE stakemate_remote_mcp_authorizations ENABLE ROW LEVEL SECURITY;
