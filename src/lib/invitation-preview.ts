import type { OneXTwoSelection } from "@/lib/duel-draft";

export const outcomeLabels: Record<OneXTwoSelection, string> = { home_win: "Home", draw: "Draw", away_win: "Away" };
export function availableOpponentSelections(creator: OneXTwoSelection) { return (Object.keys(outcomeLabels) as OneXTwoSelection[]).filter((selection) => selection !== creator); }
export function previewFundingMessage() { return "Funding window has not started. If an off-chain acknowledgement is ever approved, it would be 15 minutes and would not itself escrow funds."; }
