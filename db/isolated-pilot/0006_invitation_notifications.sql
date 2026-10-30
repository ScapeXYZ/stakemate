-- LOCAL PILOT ONLY. Do not apply to Supabase, production, or a shared database.
-- Durable recipient notification state is deliberately separated from immutable
-- invitation commitments. Existing invitation rows are preserved unchanged.
CREATE TABLE IF NOT EXISTS stakemate_invitation_notifications (
  invitation_id uuid PRIMARY KEY REFERENCES stakemate_invitations(id) ON DELETE CASCADE,
  recipient_wallet_address text NOT NULL,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS stakemate_invitation_notifications_recipient_idx
  ON stakemate_invitation_notifications (recipient_wallet_address, read_at, created_at DESC);

-- Backfill only metadata for already-persisted invitations. This does not edit
-- the accepted challenge or revive terminal invitations.
INSERT INTO stakemate_invitation_notifications (invitation_id, recipient_wallet_address, read_at, dismissed_at)
SELECT id, recipient_wallet_address,
  CASE WHEN status = 'pending' THEN NULL ELSE COALESCE(responded_at, cancelled_at, expires_at, created_at) END,
  CASE WHEN status = 'pending' THEN NULL ELSE COALESCE(responded_at, cancelled_at, expires_at, created_at) END
FROM stakemate_invitations
ON CONFLICT (invitation_id) DO NOTHING;
