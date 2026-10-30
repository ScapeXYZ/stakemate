-- Hosted Remote MCP consent requests. This is a persistence foundation only:
-- it does not issue OAuth tokens or enable /api/mcp.
CREATE TABLE stakemate_remote_mcp_consent_requests (
  id uuid PRIMARY KEY,
  oauth_subject text NOT NULL CHECK (oauth_subject <> ''),
  oauth_client_id text NOT NULL CHECK (oauth_client_id <> ''),
  requested_scopes text[] NOT NULL CHECK (cardinality(requested_scopes) > 0 AND requested_scopes <@ ARRAY['duels:prepare', 'credibility:read', 'invitations:read']::text[]),
  state_hash char(64) NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash char(64) NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'denied')),
  decision_profile_id uuid REFERENCES stakemate_profiles(id) ON DELETE RESTRICT,
  decision_wallet_address text CHECK (decision_wallet_address IS NULL OR decision_wallet_address ~ '^0x[0-9a-f]{64}$'),
  decided_at timestamptz,
  used_at timestamptz,
  CHECK (expires_at > requested_at),
  CHECK ((decision = 'pending' AND decision_profile_id IS NULL AND decision_wallet_address IS NULL AND decided_at IS NULL AND used_at IS NULL)
    OR (decision IN ('approved', 'denied') AND decision_profile_id IS NOT NULL AND decision_wallet_address IS NOT NULL AND decided_at IS NOT NULL AND used_at IS NOT NULL))
);
CREATE INDEX stakemate_remote_mcp_consent_requests_active_idx ON stakemate_remote_mcp_consent_requests (id, expires_at) WHERE decision = 'pending';

CREATE FUNCTION stakemate_guard_remote_mcp_consent_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.oauth_subject, NEW.oauth_client_id, NEW.requested_scopes, NEW.state_hash, NEW.csrf_hash, NEW.requested_at, NEW.expires_at) IS DISTINCT FROM ROW(OLD.oauth_subject, OLD.oauth_client_id, OLD.requested_scopes, OLD.state_hash, OLD.csrf_hash, OLD.requested_at, OLD.expires_at) THEN RAISE EXCEPTION 'remote MCP consent request is immutable'; END IF;
  IF OLD.decision <> 'pending' THEN RAISE EXCEPTION 'remote MCP consent decision is single use'; END IF;
  IF NEW.decision = 'pending' THEN RAISE EXCEPTION 'remote MCP consent request cannot be updated while pending'; END IF;
  IF NOT EXISTS (SELECT 1 FROM stakemate_profiles p WHERE p.id = NEW.decision_profile_id AND p.wallet_address = NEW.decision_wallet_address) THEN RAISE EXCEPTION 'remote MCP consent profile wallet binding mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stakemate_guard_remote_mcp_consent_request_trigger BEFORE INSERT OR UPDATE ON stakemate_remote_mcp_consent_requests FOR EACH ROW EXECUTE FUNCTION stakemate_guard_remote_mcp_consent_request();

ALTER TABLE stakemate_remote_mcp_consent_requests ENABLE ROW LEVEL SECURITY;
