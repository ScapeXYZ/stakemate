import { EscrowDiscovery } from "@/components/EscrowDiscovery";
import { MemoryLearningReview } from "@/components/MemoryLearningReview";
import { AgentInsights } from "@/components/AgentInsights";
import { Navbar } from "@/components/Navbar";
import { RemoteMcpConnections } from "@/components/RemoteMcpConnections";

/** Read-only Testnet discovery is deliberately separate from the football preview workflow. */
export default function ActivityPage() {
  return <main id="top"><Navbar /><section className="activity-page"><MemoryLearningReview /><AgentInsights /><RemoteMcpConnections /><EscrowDiscovery /></section><footer><span>StakeMate <b>✦</b></span><span>Testnet discovery · Read only</span></footer></main>;
}
