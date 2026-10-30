import type { MemoryRecord } from "./records";

export type ProposedMemoryRecord = { status: "proposed-unwritten"; basis: string; record: MemoryRecord };

const occurredAt = "2026-10-28T00:00:00.000Z";
const shared = { occurredAt, challengeId: "stakemate-project-evidence", actorId: "stakemate:internal-evidence", type: "reputation.insight" as const, subjectId: "stakemate:project", confidence: 1 };

/**
 * Candidate evidence only. These are truthful observations from this repository's
 * documented milestones and have never been submitted to Walrus Memory.
 */
export const proposedWalrusEvidenceRecords: readonly ProposedMemoryRecord[] = [
  { status: "proposed-unwritten", basis: "Verified Testnet deployment record", record: { ...shared, id: "010f25e6-b030-42aa-a4dc-06ee545f458b", insight: "StakeMate's challenge_escrow package was source-verified on Sui Testnet." } },
  { status: "proposed-unwritten", basis: "Verified Testnet deployment record", record: { ...shared, id: "85caea8a-1ad7-44bb-b8a1-7cfec1db8903", insight: "StakeMate's documented Sui Move scenario suite passed 22 of 22 tests before deployment." } },
  { status: "proposed-unwritten", basis: "Milestone 5 configuration", record: { ...shared, id: "d410858c-ff13-47cb-9d98-52ce155894c6", insight: "StakeMate pins its frontend escrow discovery to the verified Sui Testnet package and keeps transaction execution disabled." } },
  { status: "proposed-unwritten", basis: "Tatum Testnet evidence", record: { ...shared, id: "8fa7cac3-0e49-4429-baa0-e9c44d3117e2", insight: "Tatum native gRPC GetServiceInfo verified the StakeMate provider configuration identifies Sui Testnet." } },
  { status: "proposed-unwritten", basis: "Tatum Testnet evidence", record: { ...shared, id: "a57d28b2-c448-43a2-84eb-c7ef5f0bc07c", insight: "Tatum native gRPC GetObject verified the configured StakeMate package is a package containing challenge_escrow." } },
  { status: "proposed-unwritten", basis: "Tatum Testnet evidence", record: { ...shared, id: "67a8c9cb-ccf1-49c6-a351-bf95ea98a37f", insight: "Tatum native gRPC GetTransaction verified the configured StakeMate publish transaction completed successfully." } },
  { status: "proposed-unwritten", basis: "Walrus Memory Mainnet readiness", record: { ...shared, id: "bad43eb6-1225-4d17-8449-60ad21e0560a", insight: "Walrus Memory Mainnet health completed with the configured server-side account and delegate credentials." } },
  { status: "proposed-unwritten", basis: "Walrus Memory Mainnet readiness", record: { ...shared, id: "5af3c8c9-d1e1-457d-a7be-5a65d0232150", insight: "Walrus Memory authenticated readiness completed through a bounded recall while writes remained disabled." } },
  { status: "proposed-unwritten", basis: "Frontend wallet policy", record: { ...shared, id: "61c0a7ce-554f-4c0f-b3f5-4740f25e56a8", insight: "StakeMate supports Sui Testnet wallet connection only and blocks challenge funding and signing in the frontend." } },
  { status: "proposed-unwritten", basis: "Walrus write policy", record: { ...shared, id: "9ce5043f-2be5-45ff-8460-2994a00a9d29", insight: "StakeMate keeps Walrus Memory writes disabled pending explicit operator approval, cost confirmation, and durable receipt storage." } },
];
