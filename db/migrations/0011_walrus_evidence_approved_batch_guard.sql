-- Additive hardening for the already-approved 0009 schema. Do not edit 0009:
-- its recorded checksum is production evidence. The only importable/readable
-- batch is the independently approved, immutable ten-record batch below.

ALTER TABLE stakemate_walrus_manifests
  ADD CONSTRAINT stakemate_walrus_manifests_approved_batch_only
  CHECK (batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f');

ALTER TABLE stakemate_walrus_receipts
  ADD CONSTRAINT stakemate_walrus_receipts_approved_batch_only
  CHECK (batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f');

-- Restrictive policies are ANDed with the role-specific policies in 0010.
-- They make a future accidental permissive role policy unable to reveal or
-- insert a non-approved batch.
CREATE POLICY stakemate_walrus_evidence_approved_manifest_select
  ON stakemate_walrus_manifests AS RESTRICTIVE FOR SELECT
  USING (batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f');

CREATE POLICY stakemate_walrus_evidence_approved_manifest_insert
  ON stakemate_walrus_manifests AS RESTRICTIVE FOR INSERT
  WITH CHECK (batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f');

CREATE POLICY stakemate_walrus_evidence_approved_receipt_select
  ON stakemate_walrus_receipts AS RESTRICTIVE FOR SELECT
  USING (batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f');

CREATE POLICY stakemate_walrus_evidence_approved_receipt_insert
  ON stakemate_walrus_receipts AS RESTRICTIVE FOR INSERT
  WITH CHECK (batch_digest = '590fb9522e99b59f986fb2f26a39e894bb3870bfe51f4ba0054fc4393da9c02f');
