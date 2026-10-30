import { NextResponse } from "next/server";
import { assertFixtureUnchanged, buildDuelDraftTerms, hashDuelDraftTerms, oneXTwoSelections, type DuelDraftTerms, type OneXTwoSelection } from "@/lib/duel-draft";
import { footballCompetitions, getFootballDataClient, type FootballCompetition } from "@/lib/server/football-data";
import { getInvitationStore, invitationLifetimeMinutes, type InvitationLifetimeMinutes } from "@/lib/server/invitations";
import { authenticatedWallet, assertSameOrigin } from "@/lib/server/session";
import { ProviderError, providerRetryHeaders } from "@/lib/server/errors";

export const runtime = "nodejs";
export type DraftInput = { competition?: unknown; fixtureId?: unknown; expectedFixture?: { kickoffUtc?: unknown; homeTeamId?: unknown; awayTeamId?: unknown; providerStatus?: unknown }; creatorSelection?: unknown; opponentSelection?: unknown; opponentHandle?: unknown; stakeSui?: unknown; invitationLifetimeMinutes?: unknown };

/** Shared server authority for previews and a future explicitly gated create action. */
export async function prepareVerifiedDuelDraft(walletAddress: string, body: DraftInput): Promise<{ terms: DuelDraftTerms; termsHash: string }> {
  if (typeof body.competition !== "string" || !footballCompetitions.includes(body.competition as FootballCompetition) || typeof body.fixtureId !== "string" || typeof body.opponentHandle !== "string" || typeof body.stakeSui !== "string" || !oneXTwoSelections.includes(body.creatorSelection as OneXTwoSelection) || !oneXTwoSelections.includes(body.opponentSelection as OneXTwoSelection)) throw new Error("DRAFT_INPUT_INVALID");
  const lifetime = body.invitationLifetimeMinutes === undefined ? 15 : body.invitationLifetimeMinutes;
  if (typeof lifetime !== "number" || !invitationLifetimeMinutes.includes(lifetime as InvitationLifetimeMinutes)) throw new Error("DRAFT_INPUT_INVALID");
  const store = getInvitationStore(); const creator = await store.profileForWallet(walletAddress); if (!creator) throw new Error("PROFILE_REQUIRED");
  const opponent = await store.profileForUsername(body.opponentHandle.replace(/^@/, "")); if (!opponent) throw new Error("OPPONENT_NOT_FOUND");
  if (!body.expectedFixture || typeof body.expectedFixture.kickoffUtc !== "string" || typeof body.expectedFixture.homeTeamId !== "string" || typeof body.expectedFixture.awayTeamId !== "string" || body.expectedFixture.providerStatus !== "TIMED") throw new Error("DRAFT_INPUT_INVALID");
  const fixture = await getFootballDataClient().timedFixture(body.competition as FootballCompetition, body.fixtureId); assertFixtureUnchanged({ fixtureId: body.fixtureId, kickoffUtc: body.expectedFixture.kickoffUtc, homeTeamId: body.expectedFixture.homeTeamId, awayTeamId: body.expectedFixture.awayTeamId, providerStatus: "TIMED" }, fixture);
  const terms = buildDuelDraftTerms({ fixture, creator: { username: creator.username, walletAddress: creator.walletAddress }, opponent, creatorSelection: body.creatorSelection as OneXTwoSelection, opponentSelection: body.opponentSelection as OneXTwoSelection, stakeSui: body.stakeSui, invitationLifetimeMinutes: lifetime as InvitationLifetimeMinutes, createdAt: new Date() });
  return { terms, termsHash: hashDuelDraftTerms(terms) };
}

/** Ephemeral preview only: no invitation insert, transaction, signing, or provider-data persistence occurs here. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const session = await authenticatedWallet(); if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const prepared = await prepareVerifiedDuelDraft(session.walletAddress, await request.json() as DraftInput);
    return NextResponse.json({ previewOnly: true, fundable: false, ...prepared }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft preview unavailable.";
    if (error instanceof ProviderError) { const status = error.code === "NOT_CONFIGURED" ? 503 : error.code === "RATE_LIMIT" ? 429 : error.code === "TIMEOUT" ? 504 : 502; return NextResponse.json({ error: "Fixture revalidation failed. No draft was created.", code: error.code, ...(error.retryAfterMs ? { retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1_000)) } : {}) }, { status, headers: providerRetryHeaders(error) }); }
    if (message.includes("cannot challenge itself")) return NextResponse.json({ error: "You cannot create a duel draft against your own wallet.", code: "SELF_INVITATION" }, { status: 400 });
    return NextResponse.json({ error: message, code: "DRAFT_INVALID" }, { status: 400 });
  }
}
