import { NextResponse } from "next/server";
import { footballCompetitions, getFootballDataClient, type FootballCompetition } from "@/lib/server/football-data";
import { ProviderError, providerRetryHeaders, publicProviderStatus } from "@/lib/server/errors";

export const runtime = "nodejs";

/** Read-only result evidence lookup; it cannot settle, write Walrus, or call escrow. */
export async function GET(request: Request, { params }: { params: Promise<{ fixtureId: string }> }) {
  const competition = new URL(request.url).searchParams.get("competition");
  if (!competition || !footballCompetitions.includes(competition as FootballCompetition)) return NextResponse.json({ ok: false, code: "INVALID_COMPETITION" }, { status: 400 });
  try { const { fixtureId } = await params; return NextResponse.json({ ok: true, result: await getFootballDataClient().result(competition as FootballCompetition, fixtureId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const status = error instanceof ProviderError && error.code === "NOT_CONFIGURED" ? 503 : error instanceof ProviderError && error.code === "AUTH" ? 502 : error instanceof ProviderError && error.code === "RATE_LIMIT" ? 429 : error instanceof ProviderError && error.code === "TIMEOUT" ? 504 : 502; return NextResponse.json(publicProviderStatus(error), { status, headers: providerRetryHeaders(error) }); }
}
