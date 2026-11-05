-- NOT APPLIED. Additive, operator-approved Testnet scanner state only.
-- This stores no signing material and is intentionally separate from Walrus data.
CREATE TABLE stakemate_testnet_scanner_checkpoint (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  endpoint_id text NOT NULL CHECK (endpoint_id <> ''),
  next_checkpoint bigint NOT NULL CHECK (next_checkpoint >= 0),
  historical_coverage text NOT NULL CHECK (historical_coverage IN ('archival','forward_only')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE stakemate_testnet_observed_events (
  transaction_digest text NOT NULL,
  event_sequence bigint NOT NULL CHECK (event_sequence >= 0),
  checkpoint bigint NOT NULL CHECK (checkpoint >= 0),
  event_type text NOT NULL CHECK (event_type <> ''),
  challenge_id text NOT NULL CHECK (challenge_id ~ '^0x[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (transaction_digest, event_sequence)
);
CREATE TABLE stakemate_testnet_challenge_attestations (
  challenge_id text PRIMARY KEY CHECK (challenge_id ~ '^0x[0-9a-f]{64}$'),
  funding_transaction_digest text NOT NULL UNIQUE,
  funded_checkpoint bigint NOT NULL CHECK (funded_checkpoint >= 0),
  terms_hash char(66) NOT NULL CHECK (terms_hash ~ '^0x[0-9a-f]{64}$'),
  creator_address text NOT NULL CHECK (creator_address ~ '^0x[0-9a-f]{64}$'),
  opponent_address text NOT NULL CHECK (opponent_address ~ '^0x[0-9a-f]{64}$'),
  outcome_authority text NOT NULL CHECK (outcome_authority ~ '^0x[0-9a-f]{64}$'),
  stake_mist numeric(20,0) NOT NULL CHECK (stake_mist > 0),
  funding_deadline_ms numeric(20,0) NOT NULL,
  outcome_deadline_ms numeric(20,0) NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (funding_deadline_ms < outcome_deadline_ms)
);
ALTER TABLE stakemate_testnet_scanner_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_testnet_observed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_testnet_challenge_attestations ENABLE ROW LEVEL SECURITY;
