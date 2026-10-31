-- Execute only after a managed-provider capability audit confirms CREATE ROLE
-- and after explicit production approval. Do not put credentials in this file.

CREATE ROLE stakemate_walrus_evidence_reader LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE stakemate_walrus_evidence_importer LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT USAGE ON SCHEMA public TO stakemate_walrus_evidence_reader, stakemate_walrus_evidence_importer;
GRANT SELECT ON stakemate_walrus_manifests, stakemate_walrus_receipts TO stakemate_walrus_evidence_reader;
GRANT SELECT, INSERT ON stakemate_walrus_manifests, stakemate_walrus_receipts TO stakemate_walrus_evidence_importer;

REVOKE ALL ON stakemate_walrus_manifests, stakemate_walrus_receipts FROM PUBLIC, anon, authenticated;
