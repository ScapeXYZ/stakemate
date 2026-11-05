import { normalizeSuiAddress } from "@mysten/sui/utils";
import { ESCROW_MODULE } from "@/lib/escrow-config";

export type ChainReceipt = "confirmed" | "not_found" | "pending" | "failed";

export function classifySettlementReceipt(input: { kind: "success" | "failed"; challengeId: string; outcome: 0 | 1 | 2; events: readonly { eventType: string; json: Record<string, unknown> | null }[] }): Exclude<ChainReceipt, "not_found" | "pending"> {
  if (input.kind === "failed") return "failed";
  const eventName = input.outcome === 0 ? "ChallengeVoided" : "ChallengeSettled";
  return input.events.some((event) => {
    const eventChallengeId = event.json?.challenge_id;
    return event.eventType === `${ESCROW_MODULE}::${eventName}` && typeof eventChallengeId === "string" && normalizeSuiAddress(eventChallengeId) === normalizeSuiAddress(input.challengeId);
  }) ? "confirmed" : "failed";
}
