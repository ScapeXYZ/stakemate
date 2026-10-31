-- Durable, read-only evidence cache for already-published Walrus Mainnet data.
-- This migration never stores record payloads, delegate credentials, or wallet keys.

CREATE TABLE stakemate_walrus_manifests (
  batch_digest char(64) PRIMARY KEY CHECK (batch_digest ~ '^[0-9a-f]{64}$'),
  version smallint NOT NULL CHECK (version = 1),
  network text NOT NULL CHECK (network = 'mainnet'),
  record_count smallint NOT NULL CHECK (record_count = 10),
  manifest jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (jsonb_typeof(manifest) = 'object')
);

CREATE TABLE stakemate_walrus_receipts (
  digest char(64) PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  batch_digest char(64) NOT NULL REFERENCES stakemate_walrus_manifests(batch_digest) ON DELETE RESTRICT,
  record_id uuid NOT NULL,
  job_id text,
  blob_id text NOT NULL CHECK (btrim(blob_id) <> ''),
  prepared_at timestamptz NOT NULL,
  accepted_at timestamptz,
  completed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status = 'completed'),
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (record_id),
  UNIQUE (blob_id),
  CHECK (completed_at >= prepared_at),
  CHECK (accepted_at IS NULL OR (accepted_at >= prepared_at AND completed_at >= accepted_at))
);
CREATE INDEX stakemate_walrus_receipts_batch_idx ON stakemate_walrus_receipts (batch_digest, record_id);

ALTER TABLE stakemate_walrus_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakemate_walrus_receipts ENABLE ROW LEVEL SECURITY;
