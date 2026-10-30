"use client";

import { useState } from "react";
import { ChallengeStatus } from "./ChallengeStatus";
import type { ChallengeInput } from "@/lib/challenge";
import { fundingBlockReason } from "@/lib/wallet";
import { useCurrentNetwork, useWalletConnection } from "@mysten/dapp-kit-react";

const initial: ChallengeInput = { fixture: "", market: "", stake: "", opponent: "", deadline: "" };

export function ChallengeForm() {
  const [form] = useState(initial);
  const connection = useWalletConnection();
  const network = useCurrentNetwork();
  const fundingReason = fundingBlockReason({ connected: Boolean(connection.account), network: network ?? null, escrowContractDeployed: false });
  return <section className="challenge-panel" id="explore"><div className="panel-heading"><div><p className="eyebrow">CREATE · VERIFICATION REQUIRED</p><h2>Verified events only.</h2></div><span className="demo-badge">Creation disabled</span></div>
    <form onSubmit={(event) => event.preventDefault()} noValidate>
      <label>Fixture <select disabled value={form.fixture}><option>Verified fixture provider not configured</option></select></label>
      <label>Prediction market <select disabled value={form.market}><option>Markets unlock after fixture verification</option></select></label>
      <label>Stake amount <div className="input-suffix"><input disabled inputMode="decimal" placeholder="Verification required" value={form.stake} /><span>TESTNET SUI</span></div></label>
      <label>Opponent <input disabled placeholder="Verification required" value={form.opponent} /></label>
      <label className="wide">Deadline <input disabled type="datetime-local" value={form.deadline} /></label>
      <button className="create-button" type="submit" disabled>Challenge creation requires verified source data</button>
      <div className="funding-lock" aria-live="polite"><div><b>Testnet funding is locked</b><p>{fundingReason}</p></div><button type="button" disabled title={fundingReason ?? undefined}>Fund on testnet</button></div>
    </form><ChallengeStatus state="error" />
  </section>;
}
