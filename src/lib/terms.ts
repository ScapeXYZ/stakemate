export type CanonicalChallengeTerms = {
  creator: string;
  opponent: string;
  stakeMist: bigint;
  fixture: string;
  market: string;
  fundingDeadlineMs: bigint;
  outcomeDeadlineMs: bigint;
  outcomeAuthority: string;
};

const address = /^0x[0-9a-fA-F]{64}$/;

function normalizedAddress(value: string, field: string) {
  if (!address.test(value)) throw new Error(`${field} must be a 32-byte Sui address.`);
  return value.toLowerCase();
}

function normalizedText(value: string, field: string) {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || /[\r\n]/u.test(normalized)) throw new Error(`${field} must be non-empty and contain no line breaks.`);
  return normalized;
}

/** UTF-8, LF-delimited, fixed-order v1 format. See docs/TESTNET_INTEGRATION.md. */
export function canonicalizeChallengeTerms(terms: CanonicalChallengeTerms) {
  if (terms.stakeMist <= BigInt(0)) throw new Error("stakeMist must be greater than zero.");
  if (terms.fundingDeadlineMs >= terms.outcomeDeadlineMs) throw new Error("Outcome deadline must be after funding deadline.");
  return [
    "stakemate.challenge-terms.v1",
    `creator=${normalizedAddress(terms.creator, "creator")}`,
    `opponent=${normalizedAddress(terms.opponent, "opponent")}`,
    `stakeMist=${terms.stakeMist.toString(10)}`,
    `fixture=${normalizedText(terms.fixture, "fixture")}`,
    `market=${normalizedText(terms.market, "market")}`,
    `fundingDeadlineMs=${terms.fundingDeadlineMs.toString(10)}`,
    `outcomeDeadlineMs=${terms.outcomeDeadlineMs.toString(10)}`,
    `outcomeAuthority=${normalizedAddress(terms.outcomeAuthority, "outcomeAuthority")}`,
    "",
  ].join("\n");
}

export async function hashCanonicalChallengeTerms(terms: CanonicalChallengeTerms) {
  const bytes = new TextEncoder().encode(canonicalizeChallengeTerms(terms));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function hashHexToBytes(hash: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("Terms hash must be a SHA-256 32-byte hex digest.");
  return Uint8Array.from(hash.slice(2).match(/.{2}/g)!.map((octet) => Number.parseInt(octet, 16)));
}
