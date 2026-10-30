export type ChallengeFundingState = {
  connected: boolean;
  network: string | null;
  escrowContractDeployed: boolean;
};

export function fundingBlockReason(state: ChallengeFundingState): string | null {
  if (!state.connected) return "Connect a Sui wallet before funding a challenge.";
  if (state.network !== "testnet") return "Challenge funding is restricted to Sui Testnet.";
  if (!state.escrowContractDeployed) return "Testnet escrow is not deployed yet; funding remains unavailable.";
  return null;
}

export function shortAddress(address: string): string { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
