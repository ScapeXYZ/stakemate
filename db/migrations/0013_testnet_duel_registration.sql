-- NOT APPLIED.
-- Durable registration of immutable football duel terms and Sui Testnet challenges.
-- No signing material is stored.

CREATE TABLE stakemate_testnet_duel_registrations (
  challenge_id text PRIMARY KEY
    CHECK (challenge_id ~ '^0x[0-9a-f]{64}$'),

  creation_transaction_digest text NOT NULL UNIQUE
    CHECK (creation_transaction_digest <> ''),

  terms_hash char(66) NOT NULL
    CHECK (terms_hash ~ '^0x[0-9a-f]{64}$'),

  canonical_terms text NOT NULL
    CHECK (canonical_terms <> ''),

  fixture_provider text NOT NULL
    CHECK (fixture_provider = 'football-data.org/v4'),

  fixture_id text NOT NULL
    CHECK (fixture_id <> ''),

  competition_code text NOT NULL
    CHECK (competition_code IN ('PL', 'PD', 'CL')),

  kickoff_at timestamptz NOT NULL,

  creator_address text NOT NULL
    CHECK (creator_address ~ '^0x[0-9a-f]{64}$'),

  opponent_address text NOT NULL
    CHECK (opponent_address ~ '^0x[0-9a-f]{64}$'),

  outcome_authority text NOT NULL
    CHECK (outcome_authority ~ '^0x[0-9a-f]{64}$'),

  stake_mist numeric(20,0) NOT NULL
    CHECK (stake_mist > 0),

  registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX stakemate_testnet_duel_fixture_idx
  ON stakemate_testnet_duel_registrations
  (competition_code, fixture_id, kickoff_at);

ALTER TABLE stakemate_testnet_duel_registrations
  ENABLE ROW LEVEL SECURITY;
