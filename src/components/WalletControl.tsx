"use client";

import { useEffect, useState } from "react";
import { useCurrentClient, useCurrentNetwork, useDAppKit, useWalletConnection, useWallets } from "@mysten/dapp-kit-react";
import { shortAddress } from "@/lib/wallet";

export function WalletControl() {
  const dAppKit = useDAppKit();
  const wallets = useWallets();
  const connection = useWalletConnection();
  const client = useCurrentClient();
  const network = useCurrentNetwork();
  const [balanceState, setBalanceState] = useState<{ address: string; value?: string; error?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    let active = true;
    if (!connection.account) return;
    const address = connection.account.address;
    client.getBalance({ owner: address }).then(({ balance }) => {
      if (active) setBalanceState({ address, value: (Number(balance.balance) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 }) });
    }).catch(() => { if (active) setBalanceState({ address, error: "Balance unavailable" }); });
    return () => { active = false; };
  }, [client, connection.account]);
  async function connect(wallet: (typeof wallets)[number]) { setActionError(null); try { await dAppKit.connectWallet({ wallet }); setPickerOpen(false); } catch { setActionError("Wallet connection was not completed."); } }
  async function disconnect() { try { await dAppKit.disconnectWallet(); } catch { setActionError("Wallet disconnect failed."); } }
  if (connection.isConnecting || connection.isReconnecting) return <span className="wallet-loading">Connecting…</span>;
  if (connection.account) { const currentBalance = balanceState?.address === connection.account.address ? (balanceState.error ?? (balanceState.value ? `${balanceState.value} SUI` : "Loading balance…")) : "Loading balance…"; return <div className="wallet-summary"><button className="wallet-button connected" onClick={disconnect} title="Disconnect wallet">{shortAddress(connection.account.address)} <span>×</span></button><span className="wallet-meta">{network} · {currentBalance}</span></div>; }
  return <div className="wallet-control"><button className="wallet-button" onClick={() => setPickerOpen(!pickerOpen)}>Connect Wallet <span>↗</span></button>{pickerOpen && <div className="wallet-picker" role="dialog" aria-label="Choose a Sui wallet">{wallets.length ? wallets.map((wallet) => <button key={wallet.name} onClick={() => connect(wallet)}>{wallet.name}</button>) : <p>No compatible Sui wallet found.</p>}<small>StakeMate supports Sui Testnet only.</small></div>}{actionError && <p className="wallet-error" role="alert">{actionError}</p>}</div>;
}
