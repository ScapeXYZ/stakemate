-- Execute only after `npm run walrus:evidence:preflight` confirms the connected
-- managed-provider role has rolcreaterole=true, rolsuper=false, and
-- rolbypassrls=false, and after explicit production approval. Do not put
-- credentials in this file. These roles must never own either evidence table.

CREATE ROLE stakemate_walrus_evidence_reader LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE stakemate_walrus_evidence_importer LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT USAGE ON SCHEMA public TO stakemate_walrus_evidence_reader, stakemate_walrus_evidence_importer;
GRANT SELECT ON stakemate_walrus_manifests, stakemate_walrus_receipts TO stakemate_walrus_evidence_reader;
GRANT SELECT, INSERT ON stakemate_walrus_manifests, stakemate_walrus_receipts TO stakemate_walrus_evidence_importer;

REVOKE ALL ON stakemate_walrus_manifests, stakemate_walrus_receipts FROM PUBLIC;

-- Supabase-style roles are not present on every managed PostgreSQL provider.
-- Revoke them if present without making a provider that lacks them fail setup.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON stakemate_walrus_manifests, stakemate_walrus_receipts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON stakemate_walrus_manifests, stakemate_walrus_receipts FROM authenticated;
  END IF;
END $$;
