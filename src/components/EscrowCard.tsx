export function EscrowCard() {
  return <article className="feature-card escrow-card">
    <div className="card-eyebrow"><span className="dot mint" /> DEMO ESCROW</div>
    <div className="escrow-icon">⌁</div>
    <p className="card-kicker">Challenge pool</p>
    <h3>24.00 <small>SUI</small></h3>
    <p className="card-copy">Funds are simulated. No wallet connection or on-chain escrow is active.</p>
    <div className="card-footer"><span>2 participants</span><span className="pill">Draft</span></div>
  </article>;
}
