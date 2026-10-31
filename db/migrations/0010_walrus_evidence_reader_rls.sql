-- Additive follow-up to 0009. Role creation is deliberately external because
-- managed PostgreSQL providers may prohibit CREATE ROLE for project owners.
-- These policies remain inert until the approved named roles receive grants.

CREATE POLICY stakemate_walrus_evidence_reader_manifest_select
  ON stakemate_walrus_manifests
  FOR SELECT
  USING (current_user = 'stakemate_walrus_evidence_reader');

CREATE POLICY stakemate_walrus_evidence_reader_receipt_select
  ON stakemate_walrus_receipts
  FOR SELECT
  USING (current_user = 'stakemate_walrus_evidence_reader');

CREATE POLICY stakemate_walrus_evidence_importer_manifest_select
  ON stakemate_walrus_manifests
  FOR SELECT
  USING (current_user = 'stakemate_walrus_evidence_importer');

CREATE POLICY stakemate_walrus_evidence_importer_manifest_insert
  ON stakemate_walrus_manifests
  FOR INSERT
  WITH CHECK (current_user = 'stakemate_walrus_evidence_importer');

CREATE POLICY stakemate_walrus_evidence_importer_receipt_select
  ON stakemate_walrus_receipts
  FOR SELECT
  USING (current_user = 'stakemate_walrus_evidence_importer');

CREATE POLICY stakemate_walrus_evidence_importer_receipt_insert
  ON stakemate_walrus_receipts
  FOR INSERT
  WITH CHECK (current_user = 'stakemate_walrus_evidence_importer');
