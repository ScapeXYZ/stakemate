import { Navbar } from "@/components/Navbar";
import { InvitationHub } from "@/components/InvitationHub";
import { FeaturedMatches } from "@/components/FeaturedMatches";
import { InvitationPreviewBuilder } from "@/components/InvitationPreviewBuilder";
import { isolatedInvitationPilotEnabled } from "@/lib/server/invitation-lifecycle-gate";

// The pilot gate is process-environment dependent. Never pre-render its value
// during a different build/deployment environment.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function Home() {
  const invitationPilotEnabled = isolatedInvitationPilotEnabled();
  return <main id="top"><Navbar /><div className="page-grid" />
    <section className="hero hero-compact"><div className="hero-copy"><p className="eyebrow">FOOTBALL CHALLENGES · {invitationPilotEnabled ? "ISOLATED PILOT" : "PREVIEW ONLY"}</p><h1>Make every <i>matchday</i> matter.</h1><p className="hero-text">Discover real upcoming fixtures and prepare an immutable 1X2 duel review with a friend.</p><div className="hero-actions"><a className="primary-link" href="#featured-matches">Explore fixtures <span>→</span></a><a className="text-link" href="#prepare-duel">{invitationPilotEnabled ? "Create a duel invitation" : "Prepare a duel preview"} <span>↓</span></a></div><p className="disclaimer">{invitationPilotEnabled ? "Local pilot invitations are off-chain only — no wallet funding, signing, settlement, or Walrus writes are available." : "Preview only — no invitation sending, wallet funding, signing, settlement, or Walrus writes are available."}</p></div>
      <aside className="hero-summary" aria-label="StakeMate preview status"><span className="summary-mark">✦</span><div><strong>Real fixture discovery</strong><p>Premier League, La Liga, and Champions League fixtures from football-data.org.</p></div><div><strong>Terms before action</strong><p>Preview the exact selections, MIST stake, expiry, and canonical hash. Nothing is sent or funded.</p></div></aside>
    </section>
    <FeaturedMatches invitationPilotEnabled={invitationPilotEnabled} />
    <InvitationPreviewBuilder allowInvitationCreate={invitationPilotEnabled} />
    <InvitationHub invitationPilotEnabled={invitationPilotEnabled} />
    <section className="ai-assistant-card" id="memory-loop" aria-labelledby="memory-loop-heading"><div className="ai-assistant-icon" aria-hidden="true">◌</div><div><p className="eyebrow">WALRUS MEMORY · MAINNET LEARNING LOOP</p><h2 id="memory-loop-heading">Evidence becomes memory. Memory earns its recommendation.</h2><p>StakeMate prepares versioned prediction, challenge, result, credibility, and agent-learning records. Only an approval-gated Mainnet receipt and provenance-validated recall can influence a future recommendation. Memory writes remain disabled.</p></div><a className="primary-link" href="#memory-loop">Mainnet write gated <span>✓</span></a></section>
    <section className="ai-assistant-card" id="ai-agent" aria-labelledby="ai-agent-heading"><div className="ai-assistant-icon" aria-hidden="true">✦</div><div><p className="eyebrow">AI DUEL ASSISTANT · LOCAL MCP PREVIEW</p><h2 id="ai-agent-heading">Find a match. Prepare terms. Review every detail.</h2><p>In the isolated pilot, a locally paired Claude Desktop MCP client can read verified fixtures, resolve a registered username, prepare a draft, and read wallet-scoped history. Remote MCP is disabled. No agent gets wallet access, signing authority, invitation sending, or funding capability.</p></div><a className="primary-link" href="#my-challenges">Connect a local agent <span>→</span></a></section>
    <footer><span>StakeMate <b>✦</b></span><span>Hackathon prototype · Demo mode</span></footer>
  </main>;
}
