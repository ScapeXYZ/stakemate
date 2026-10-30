-- OAuth authorization-request binding for the local Remote MCP preview only.
-- This migration neither enables /api/mcp nor issues authorization codes/tokens.
ALTER TABLE stakemate_remote_mcp_consent_requests
  ADD COLUMN oauth_state_hash char(64),
  ADD COLUMN redirect_uri text,
  ADD COLUMN pkce_code_challenge text,
  ADD COLUMN pkce_code_challenge_method text;

ALTER TABLE stakemate_remote_mcp_consent_requests
  ADD CONSTRAINT stakemate_remote_mcp_consent_oauth_binding_check CHECK (
    (oauth_state_hash IS NULL AND redirect_uri IS NULL AND pkce_code_challenge IS NULL AND pkce_code_challenge_method IS NULL)
    OR (oauth_state_hash ~ '^[0-9a-f]{64}$'
      AND redirect_uri <> ''
      AND pkce_code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'
      AND pkce_code_challenge_method = 'S256')
  );

CREATE OR REPLACE FUNCTION stakemate_guard_remote_mcp_consent_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.oauth_subject, NEW.oauth_client_id, NEW.requested_scopes, NEW.state_hash, NEW.csrf_hash, NEW.requested_at, NEW.expires_at, NEW.oauth_state_hash, NEW.redirect_uri, NEW.pkce_code_challenge, NEW.pkce_code_challenge_method)
    IS DISTINCT FROM ROW(OLD.oauth_subject, OLD.oauth_client_id, OLD.requested_scopes, OLD.state_hash, OLD.csrf_hash, OLD.requested_at, OLD.expires_at, OLD.oauth_state_hash, OLD.redirect_uri, OLD.pkce_code_challenge, OLD.pkce_code_challenge_method) THEN
    RAISE EXCEPTION 'remote MCP consent request is immutable';
  END IF;
  IF OLD.decision <> 'pending' THEN RAISE EXCEPTION 'remote MCP consent decision is single use'; END IF;
  IF NEW.decision = 'pending' THEN RAISE EXCEPTION 'remote MCP consent request cannot be updated while pending'; END IF;
  IF NOT EXISTS (SELECT 1 FROM stakemate_profiles p WHERE p.id = NEW.decision_profile_id AND p.wallet_address = NEW.decision_wallet_address) THEN
    RAISE EXCEPTION 'remote MCP consent profile wallet binding mismatch';
  END IF;
  RETURN NEW;
END;
$$;
