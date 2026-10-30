"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { discoverEscrowEvents, EscrowEvent } from "@/lib/escrow-discovery";
import { ESCROW_DEPLOYMENT } from "@/lib/escrow-config";

export function EscrowDiscovery() {
  const client = useMemo(() => new SuiGraphQLClient({ network: "testnet", url: ESCROW_DEPLOYMENT.graphqlUrl }), []);
  const [events, setEvents] = useState<EscrowEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const load = useCallback(async (nextCursor?: string | null) => {
    setStatus("loading");
    try { const page = await discoverEscrowEvents(client, nextCursor); setEvents((previous) => nextCursor ? [...previous, ...page.items] : page.items); setCursor(page.cursor); setMore(page.hasNextPage); setStatus(page.items.length || nextCursor ? "ready" : "empty"); } catch { setStatus("error"); }
  }, [client]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]); // client is Testnet-only in WalletProvider.
  return <section className="principles" aria-live="polite"><p className="eyebrow">TESTNET ESCROW ACTIVITY · READ ONLY</p><h2>Verified deployment discovery</h2>
    {status === "loading" && <p>Loading Testnet escrow events…</p>}
    {status === "empty" && <p>No StakeMate escrow events have been indexed yet.</p>}
    {status === "error" && <p role="alert">Testnet escrow activity is unavailable. No transaction was attempted.</p>}
    {status === "ready" && <div>{events.map((event) => <article key={`${event.transactionDigest}-${event.type}`}><span>EVENT</span><h3>{event.type.split("::").at(-1)}</h3><p>Transaction {event.transactionDigest.slice(0, 12)}… · checkpoint {event.checkpoint ?? "pending"}</p></article>)}</div>}
    {more && <button className="text-link" type="button" onClick={() => void load(cursor)}>Load earlier Testnet events</button>}
  </section>;
}
