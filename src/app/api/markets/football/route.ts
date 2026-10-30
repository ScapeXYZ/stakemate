import { NextResponse } from "next/server";
import { footballCompetitions, getFootballDataClient, type FootballCompetition } from "@/lib/server/football-data";
import { ProviderError, providerRetryHeaders, publicProviderStatus } from "@/lib/server/errors";

export const runtime = "nodejs";

/** Public, read-only fixture discovery. Provider credentials remain server-side. */
export async function GET(request: Request) {
  const competition = new URL(request.url).searchParams.get("competition") ?? "PL";
  if (!footballCompetitions.includes(competition as FootballCompetition)) return NextResponse.json({ ok: false, code: "INVALID_COMPETITION" }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...(await getFootballDataClient().upcoming(competition as FootballCompetition)) }, { headers: { "Cache-Control": "private, max-age=30" } }); }
  catch (error) { const status = error instanceof ProviderError && error.code === "NOT_CONFIGURED" ? 503 : error instanceof ProviderError && error.code === "AUTH" ? 502 : error instanceof ProviderError && error.code === "RATE_LIMIT" ? 429 : error instanceof ProviderError && error.code === "TIMEOUT" ? 504 : 502; return NextResponse.json(publicProviderStatus(error), { status, headers: providerRetryHeaders(error) }); }
}
