"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { InvitationCountdown } from "@/components/InvitationCountdown";
import { useWalletConnection } from "@mysten/dapp-kit-react";
import { identityForConnectedWallet, type SessionIdentity } from "@/lib/wallet-identity-display";
import { outcomeLabels } from "@/lib/invitation-preview";
import { assertPreviewFixtureEligible, duelPreviewFixtureEvent, fixtureHandoffKey, type DuelPreviewFixture } from "@/lib/duel-preview-handoff";
import type { OneXTwoSelection } from "@/lib/duel-draft";
import { suiToMist } from "@/lib/sui-mist";

type Featured = { ok: true; leagues: Record<"PL" | "PD" | "CL", { fixtures: DuelPreviewFixture[] }> } | { ok: false; code: string };
type Draft = { previewOnly: true; fundable: false; termsHash: string; terms: { fixture: DuelPreviewFixture; creator: { username: string }; opponent: { username: string }; creatorSelection: OneXTwoSelection; opponentSelection: OneXTwoSelection; unselectedOutcome: OneXTwoSelection; stakeMist: string; invitationLifetimeMinutes: 10 | 15; invitationExpiresAtUtc: string; outcomeRule: string } };
type CreatedInvitation = { invitation: { id: string; status: string; coreHash: string }; acknowledgementOnly: true; fundingApproved: false };
// Opposing winner picks are the only invitation market in this pilot. A draw
// is the committed refund outcome, never a selectable prediction.
const selections: OneXTwoSelection[] = ["home_win", "away_win"];
async function requestDraft(body: unknown) { const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15_000); try { const response = await fetch("/api/duels/draft", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Preview unavailable."); return result as Draft; } catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw new Error("Fixture revalidation timed out. No invitation was created; try again shortly."); throw error; } finally { window.clearTimeout(timer); } }
async function createInvitation(body: unknown) { const response = await fetch("/api/invitations/create", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Invitation was not created."); return result as CreatedInvitation; }
function matchesReturnedFixture(selected: DuelPreviewFixture, result: Draft) { const fixture = result.terms.fixture; return selected.fixtureId === fixture.fixtureId && selected.competitionCode === fixture.competitionCode && selected.kickoffUtc === fixture.kickoffUtc && selected.homeTeam.id === fixture.homeTeam.id && selected.awayTeam.id === fixture.awayTeam.id && fixture.providerStatus === "TIMED"; }

/** The sole browser workflow for an immutable, server-revalidated football duel preview. */
export function InvitationPreviewBuilder({ allowInvitationCreate = false }: { allowInvitationCreate?: boolean }) {
  const connection = useWalletConnection();
  const [featured, setFeatured] = useState<Featured | null>(null); const [handoff, setHandoff] = useState<DuelPreviewFixture | null>(null); const [fixtureKey, setFixtureKey] = useState(""); const [handle, setHandle] = useState(""); const [stakeSui, setStakeSui] = useState("0.1"); const [creatorSelection, setCreatorSelection] = useState<OneXTwoSelection>("home_win"); const [opponentSelection, setOpponentSelection] = useState<OneXTwoSelection>("away_win"); const [lifetime, setLifetime] = useState<10 | 15>(15); const [draft, setDraft] = useState<Draft | null>(null); const [created, setCreated] = useState<CreatedInvitation | null>(null); const [message, setMessage] = useState("Choose a verified TIMED fixture to prepare an immutable review."); const [busy, setBusy] = useState(false); const [authenticatedAddress, setAuthenticatedAddress] = useState<string | null>(null); const section = useRef<HTMLElement>(null);
  const authenticated = Boolean(connection.account?.address && authenticatedAddress === connection.account.address);
  useEffect(() => { let active = true; void fetch("/api/markets/football/featured", { cache: "no-store" }).then((result) => result.json()).then((result: Featured) => { if (active) setFeatured(result); }).catch(() => { if (active) setFeatured({ ok: false, code: "UNAVAILABLE" }); }); return () => { active = false; }; }, []);
  useEffect(() => {
    let active = true;
    const address = connection.account?.address;
    if (!address) return () => { active = false; };
    void fetch("/api/profile/username", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as SessionIdentity : null)
      .then((session) => { if (active) setAuthenticatedAddress(session && identityForConnectedWallet(address, session) ? address : null); })
      .catch(() => { if (active) setAuthenticatedAddress(null); });
    return () => { active = false; };
  }, [connection.account?.address]);
  useEffect(() => { const receive = (event: Event) => { const fixture = (event as CustomEvent<DuelPreviewFixture>).detail; try { assertPreviewFixtureEligible(fixture); setHandoff(fixture); setFixtureKey(fixtureHandoffKey(fixture)); setDraft(null); setMessage(`${fixture.homeTeam.name} vs ${fixture.awayTeam.name} selected. Complete the preview-only terms below.`); window.setTimeout(() => section.current?.focus(), 0); } catch (error) { setMessage(error instanceof Error ? error.message : "Selected fixture is unavailable."); } }; window.addEventListener(duelPreviewFixtureEvent, receive); return () => window.removeEventListener(duelPreviewFixtureEvent, receive); }, []);
  const featuredFixtures = useMemo(() => featured?.ok ? [...featured.leagues.PL.fixtures, ...featured.leagues.PD.fixtures, ...featured.leagues.CL.fixtures].filter((fixture) => fixture.providerStatus === "TIMED" && fixture.eligibility === "eligible") : [], [featured]);
  const fixtures = useMemo(() => handoff && !featuredFixtures.some((fixture) => fixtureHandoffKey(fixture) === fixtureHandoffKey(handoff)) ? [handoff, ...featuredFixtures] : featuredFixtures, [featuredFixtures, handoff]);
  const fixture = fixtures.find((item) => fixtureHandoffKey(item) === fixtureKey);
  function clearReview() { setDraft(null); setCreated(null); }
  function chooseFixture(value: string) { setFixtureKey(value); setHandoff(null); clearReview(); }
  function chooseCreator(value: OneXTwoSelection) { setCreatorSelection(value); setOpponentSelection(value === "home_win" ? "away_win" : "home_win"); clearReview(); }
  async function prepare() {
    if (!authenticated) return setMessage(connection.account ? "Authenticate this wallet and claim a StakeMate username before preparing a duel." : "Connect, authenticate, and claim a StakeMate username before preparing a duel.");
    if (!fixture) return setMessage("Select a currently eligible TIMED fixture.");
    if (!handle.trim()) return setMessage("Enter a verified opponent @username before preparing a preview.");
    if (creatorSelection === opponentSelection) return setMessage("Creator and opponent must select different 1X2 outcomes.");
    try { assertPreviewFixtureEligible(fixture); suiToMist(stakeSui); } catch (error) { return setMessage(error instanceof Error ? error.message : "Enter a valid exact SUI stake."); }
    setBusy(true); setDraft(null); setMessage("Revalidating the selected fixture and verified wallet identities…");
    try { const result = await requestDraft({ competition: fixture.competitionCode, fixtureId: fixture.fixtureId, expectedFixture: { kickoffUtc: fixture.kickoffUtc, homeTeamId: fixture.homeTeam.id, awayTeamId: fixture.awayTeam.id, providerStatus: "TIMED" }, creatorSelection, opponentSelection, opponentHandle: handle, stakeSui, invitationLifetimeMinutes: lifetime }); if (!matchesReturnedFixture(fixture, result)) throw new Error("Fixture changed during revalidation. Refresh fixtures and choose it again."); setDraft(result); setMessage("Immutable preview prepared. Nothing was sent, accepted, or funded."); } catch (error) { setMessage(error instanceof Error ? error.message : "Preview unavailable."); } finally { setBusy(false); }
  }
  async function send() {
    if (!allowInvitationCreate) { setMessage("Invitation creation is available only in the isolated localhost:3001 pilot."); return; }
    if (!fixture || !draft) return;
    setBusy(true); setMessage("Revalidating and recording the invitation…");
    try {
      const created = await createInvitation({ competition: fixture.competitionCode, fixtureId: fixture.fixtureId, expectedFixture: { kickoffUtc: fixture.kickoffUtc, homeTeamId: fixture.homeTeam.id, awayTeamId: fixture.awayTeam.id, providerStatus: "TIMED" }, creatorSelection, opponentSelection, opponentHandle: handle, stakeSui, invitationLifetimeMinutes: lifetime, idempotencyKey: crypto.randomUUID() });
      setCreated(created); setMessage("Invitation recorded. It is an off-chain acknowledgement request only; funding remains disabled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invitation was not created."); } finally { setBusy(false); }
  }
  const opponentChoices: OneXTwoSelection[] = [creatorSelection === "home_win" ? "away_win" : "home_win"];
  return <section className="duel-preview" id="prepare-duel" ref={section} tabIndex={-1} aria-labelledby="prepare-duel-heading">
    <p className="eyebrow">{allowInvitationCreate ? "ISOLATED-PILOT INVITATION" : "CANONICAL DUEL PREVIEW"}</p>
    <h2 id="prepare-duel-heading">{allowInvitationCreate ? "Create a football duel invitation" : "Prepare a football duel"}</h2>
    <p>The server revalidates the provider fixture, kickoff, teams, immutable usernames, opposing selections, and exact stake before an invitation is recorded.</p>
    <div className="preview-grid">
      <label>Verified TIMED fixture<select aria-label="Featured fixture" value={fixtureKey} onChange={(event) => chooseFixture(event.target.value)} disabled={busy}><option value="">{featured === null ? "Loading verified fixtures…" : "Select a TIMED fixture"}</option>{fixtures.map((item) => <option key={fixtureHandoffKey(item)} value={fixtureHandoffKey(item)}>{item.competitionCode} · {item.homeTeam.name} vs {item.awayTeam.name}</option>)}</select></label>
      <label>Recipient @username<input aria-label="Opponent handle" value={handle} onChange={(event) => { setHandle(event.target.value); clearReview(); }} placeholder="@virus" maxLength={25} disabled={busy} /><small>Resolved to a registered immutable wallet identity server-side.</small></label>
      <label>Your prediction<select aria-label="Creator selection" value={creatorSelection} onChange={(event) => chooseCreator(event.target.value as OneXTwoSelection)} disabled={busy}>{selections.map((choice) => <option key={choice} value={choice}>{outcomeLabels[choice]}</option>)}</select></label>
      <label>Recipient prediction<select aria-label="Opponent selection" value={opponentSelection} onChange={(event) => { setOpponentSelection(event.target.value as OneXTwoSelection); clearReview(); }} disabled={busy}>{opponentChoices.map((choice) => <option key={choice} value={choice}>{outcomeLabels[choice]}</option>)}</select></label>
      <label>Proposed stake (SUI)<input aria-label="Exact SUI stake" inputMode="decimal" value={stakeSui} onChange={(event) => { setStakeSui(event.target.value); clearReview(); }} disabled={busy} /><small>Exact integer MIST; this does not request funding.</small></label>
      <label>Invitation expiry<select aria-label="Invitation expiry" value={lifetime} onChange={(event) => { setLifetime(Number(event.target.value) as 10 | 15); clearReview(); }} disabled={busy}><option value={10}>10 minutes</option><option value={15}>15 minutes</option></select></label>
    </div>
    <button className="wallet-button" disabled={busy || !fixture || !handle.trim() || !authenticated} onClick={prepare}>{busy ? "Revalidating fixture…" : !authenticated ? connection.account ? "Authenticate wallet first" : "Connect wallet first" : allowInvitationCreate ? "Review Create Duel Invitation" : "Prepare immutable review"}</button>
    <p className="preview-status" aria-live="polite">{message}</p>
    {fixture && <p className="fixture-note">Selected: {fixture.competitionName} · {fixture.homeTeam.name} vs {fixture.awayTeam.name} · football-data.org</p>}
    {draft && <div className="terms-review"><p className="eyebrow">IMMUTABLE INVITATION TERMS</p><h3>{draft.terms.fixture.homeTeam.name} vs {draft.terms.fixture.awayTeam.name}</h3><dl><dt>Challenger / recipient</dt><dd>@{draft.terms.creator.username} picks {outcomeLabels[draft.terms.creatorSelection]}; @{draft.terms.opponent.username} picks {outcomeLabels[draft.terms.opponentSelection]}</dd><dt>Exact stake</dt><dd>{draft.terms.stakeMist} MIST each · proposed only, no funding</dd><dt>Draw refund rule</dt><dd>If the match finishes level, each participant receives 100% of their original escrow principal. Network gas is separate.</dd><dt>Invitation expiry</dt><dd><InvitationCountdown expiresAt={draft.terms.invitationExpiresAtUtc} serverNow={new Date().toISOString()} /> · {draft.terms.invitationLifetimeMinutes} minute policy</dd><dt>Canonical terms hash</dt><dd><code>{draft.termsHash}</code></dd></dl>{allowInvitationCreate ? <button className="wallet-button" disabled={busy || Boolean(created)} onClick={send}>{created ? "Duel Invitation Created" : "Create Duel Invitation"}</button> : <p className="disclaimer">Invitation creation is available only in the isolated localhost:3001 pilot.</p>}{created && <p><a href={`/invite/${created.invitation.id}`}>Open invitation evidence</a> · funding, signing, settlement, and Walrus writes remain disabled.</p>}</div>}
  </section>;
}
