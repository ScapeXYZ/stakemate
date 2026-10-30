-- Milestone 7.12: immutable duel binding and wallet/deadline snapshots.
-- Apply after 0001. Existing historical rows are intentionally not backfilled: they
-- cannot honestly be assigned a duel-draft digest retroactively.
ALTER TABLE stakemate_invitations
  ADD COLUMN duel_terms_hash char(64),
  ADD COLUMN creator_wallet_address text,
  ADD COLUMN recipient_wallet_address text,
  ADD COLUMN accepted_wallet_address text,
  ADD COLUMN funding_deadline_at timestamptz,
  ADD COLUMN outcome_deadline_at timestamptz;

ALTER TABLE stakemate_invitations
  ADD CONSTRAINT stakemate_invitations_duel_hash_format CHECK (duel_terms_hash IS NULL OR duel_terms_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT stakemate_invitations_funding_after_acceptance CHECK (funding_deadline_at IS NULL OR (responded_at IS NOT NULL AND funding_deadline_at > responded_at)),
  ADD CONSTRAINT stakemate_invitations_funding_before_outcome CHECK (funding_deadline_at IS NULL OR (outcome_deadline_at IS NOT NULL AND funding_deadline_at < outcome_deadline_at)),
  ADD CONSTRAINT stakemate_invitations_accept_wallet_only_when_accepted CHECK (accepted_wallet_address IS NULL OR status = 'accepted');

-- Future server-authoritative inserts populate every column above. Keeping these
-- nullable makes this deployment safe for pre-7.12 rows; the application rejects
-- legacy rows for future acceptance/funding workflows.
CREATE INDEX stakemate_invitations_creator_status_idx ON stakemate_invitations (creator_profile_id, status, expires_at);
CREATE INDEX stakemate_invitations_recipient_wallet_pending_idx ON stakemate_invitations (recipient_wallet_address, status, expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX stakemate_invitations_unique_pending_duel_idx ON stakemate_invitations (creator_wallet_address, recipient_wallet_address, duel_terms_hash) WHERE status = 'pending';
