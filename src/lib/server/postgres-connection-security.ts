/** TLS policy for server-only PostgreSQL adapters.
 *
 * Plaintext is permitted exclusively for an exact loopback hostname. Every
 * remote URL is forced to TLS, even if its query string asks for sslmode=disable.
 */
export type PostgresSsl = "require" | false;

function databaseUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("DATABASE_URL_INVALID"); }
  if ((parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") || !parsed.hostname) throw new Error("DATABASE_URL_INVALID");
  return parsed;
}

export function isExplicitLocalPostgresUrl(value: string) {
  const hostname = databaseUrl(value).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost";
}

/** Reject an attempted plaintext override for any non-loopback database. */
export function postgresSslForDatabaseUrl(value: string, requested?: PostgresSsl): PostgresSsl {
  const local = isExplicitLocalPostgresUrl(value);
  if (requested === false && !local) throw new Error("DATABASE_SSL_DOWNGRADE_REFUSED");
  return requested ?? (local ? false : "require");
}

/** Guard used by the manually started isolated two-wallet pilot. */
export function assertIsolatedPilotDatabaseUrl(value: string) {
  const parsed = databaseUrl(value);
  if (!isExplicitLocalPostgresUrl(value) || parsed.port !== "55435") throw new Error("ISOLATED_PILOT_DATABASE_NOT_LOCAL");
  return parsed;
}
