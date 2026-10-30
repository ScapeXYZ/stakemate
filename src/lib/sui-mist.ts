/**
 * Exact, browser-safe SUI decimal to MIST conversion.
 *
 * This module deliberately has no server or cryptographic dependencies so the
 * preview form and server-side canonical draft builder use one implementation.
 */
export function suiToMist(value: string) {
  const text = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/u.exec(text);
  if (!match) throw new Error("Stake must be a non-scientific SUI decimal with at most 9 fractional digits.");
  const mist = BigInt(match[1]) * BigInt(1_000_000_000) + BigInt((match[2] ?? "").padEnd(9, "0") || "0");
  if (mist <= BigInt(0)) throw new Error("Stake must be greater than zero.");
  return mist.toString();
}
