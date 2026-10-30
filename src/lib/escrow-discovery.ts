import { CHALLENGE_TYPE, ESCROW_MODULE } from "./escrow-config";

export type EscrowChallenge = { id: string; creator: string; opponent: string; stakeMist: bigint; termsHashHex: string; fundingDeadlineMs: bigint; outcomeDeadlineMs: bigint; outcomeAuthority: string; state: 0 | 1 | 2 | 3 };
export type EscrowEvent = { type: string; transactionDigest: string; checkpoint: string | null; data: Record<string, unknown> };
export type EscrowPage<T> = { items: T[]; cursor: string | null; hasNextPage: boolean };

function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Malformed ${label}.`); return value as Record<string, unknown>; }
function text(value: unknown, label: string) { if (typeof value !== "string") throw new Error(`Malformed ${label}.`); return value; }
function uint(value: unknown, label: string) { const result = BigInt(text(value, label)); if (result < BigInt(0)) throw new Error(`Malformed ${label}.`); return result; }
function address(value: unknown, label: string) { const result = text(value, label); if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error(`Malformed ${label}.`); return result.toLowerCase(); }

/** Parses RPC JSON defensively; an unexpected shape is an error, never a guessed challenge. */
export function parseChallengeObject(objectId: string, type: string, json: unknown): EscrowChallenge {
  if (type !== CHALLENGE_TYPE) throw new Error("Object is not a StakeMate Testnet Challenge.");
  const fields = record(json, "challenge object");
  const id = record(fields.id, "challenge ID");
  const terms = fields.terms_hash;
  if (!Array.isArray(terms) || terms.length !== 32 || !terms.every((value) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255)) throw new Error("Malformed challenge terms hash.");
  const state = Number(uint(fields.state, "challenge state"));
  if (![0, 1, 2, 3].includes(state)) throw new Error("Malformed challenge state.");
  return { id: address(id.id ?? objectId, "challenge ID"), creator: address(fields.creator, "creator"), opponent: address(fields.opponent, "opponent"), stakeMist: uint(fields.stake_mist, "stake"), termsHashHex: `0x${terms.map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`, fundingDeadlineMs: uint(fields.funding_deadline_ms, "funding deadline"), outcomeDeadlineMs: uint(fields.outcome_deadline_ms, "outcome deadline"), outcomeAuthority: address(fields.outcome_authority, "outcome authority"), state: state as 0 | 1 | 2 | 3 };
}

type ReadClient = { getObject(input: { objectId: string; include: { json: true } }): Promise<{ object: { objectId: string; type: string; json: Record<string, unknown> | null } }>; listEvents(input: { filter: { emitModule: string }; limit: number; before?: string | null; order: "descending" }): Promise<{ events: Array<{ eventType: string; transactionDigest: string; checkpoint: string | null; json: Record<string, unknown> | null }>; endCursor: string | null; hasNextPage: boolean }> };

export async function discoverEscrowEvents(client: ReadClient, cursor?: string | null, limit = 20): Promise<EscrowPage<EscrowEvent>> {
  const page = await client.listEvents({ filter: { emitModule: ESCROW_MODULE }, limit: Math.min(Math.max(limit, 1), 50), before: cursor ?? null, order: "descending" });
  return { items: page.events.map((event) => ({ type: event.eventType, transactionDigest: event.transactionDigest, checkpoint: event.checkpoint, data: event.json ?? {} })), cursor: page.endCursor, hasNextPage: page.hasNextPage };
}

export async function getEscrowChallenge(client: ReadClient, challengeId: string) {
  const response = await client.getObject({ objectId: challengeId, include: { json: true } });
  return parseChallengeObject(response.object.objectId, response.object.type, response.object.json);
}
