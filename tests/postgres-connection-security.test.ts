import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedPilotDatabaseUrl, isExplicitLocalPostgresUrl, postgresSslForDatabaseUrl } from "../src/lib/server/postgres-connection-security";

test("only exact localhost PostgreSQL URLs may use plaintext TLS mode", () => {
  assert.equal(isExplicitLocalPostgresUrl("postgres://user:pass@127.0.0.1:55435/stakemate"), true);
  assert.equal(isExplicitLocalPostgresUrl("postgresql://user:pass@localhost:5432/stakemate"), true);
  assert.equal(postgresSslForDatabaseUrl("postgres://user:pass@127.0.0.1:55435/stakemate"), false);
  assert.equal(postgresSslForDatabaseUrl("postgres://user:pass@localhost:5432/stakemate", false), false);
});

test("remote PostgreSQL always requires TLS and rejects plaintext downgrade attempts", () => {
  const remote = "postgres://user:pass@db.example.test:6543/stakemate?sslmode=disable";
  assert.equal(postgresSslForDatabaseUrl(remote), "require");
  assert.throws(() => postgresSslForDatabaseUrl(remote, false), /DATABASE_SSL_DOWNGRADE_REFUSED/);
  assert.equal(isExplicitLocalPostgresUrl("postgres://user:pass@127.0.0.2:5432/stakemate"), false);
  assert.throws(() => postgresSslForDatabaseUrl("not a database url"), /DATABASE_URL_INVALID/);
});

test("isolated pilot guard accepts only the expected loopback port", () => {
  assert.equal(assertIsolatedPilotDatabaseUrl("postgres://user:pass@127.0.0.1:55435/stakemate").port, "55435");
  assert.throws(() => assertIsolatedPilotDatabaseUrl("postgres://user:pass@localhost:55432/stakemate"), /ISOLATED_PILOT_DATABASE_NOT_LOCAL/);
  assert.throws(() => assertIsolatedPilotDatabaseUrl("postgres://user:pass@db.example.test:55435/stakemate"), /ISOLATED_PILOT_DATABASE_NOT_LOCAL/);
});
