import { NextResponse } from "next/server";
import { rankFeaturedByLeague } from "@/lib/featured-fixtures";
import { footballCompetitions, getFootballDataClient } from "@/lib/server/football-data";
import { ProviderError, providerRetryHeaders, publicProviderStatus } from "@/lib/server/errors";

export const runtime = "nodejs";
let inFlight: Promise<ReturnType<typeof rankFeaturedByLeague>> | undefined;

async function load() {
  const client = getFootballDataClient(); const responses = [];
  for (const competition of footballCompetitions) {
    try { responses.push(await client.upcoming(competition)); }
    catch (error) {
      if (!(error instanceof ProviderError) || error.code !== "RATE_LIMIT" || !error.retryAfterMs) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, error.retryAfterMs));
      responses.push(await client.upcoming(competition));
    }
  }
  return rankFeaturedByLeague(responses);
}

/** One bounded, read-only, server-side load; subsequent requests reuse the provider cache. */
export async function GET() {
  try { inFlight ??= load().finally(() => { inFlight = undefined; }); return NextResponse.json({ ok: true, leagues: await inFlight }, { headers: { "Cache-Control": "private, max-age=30" } }); }
  catch (error) { const status = error instanceof ProviderError && error.code === "RATE_LIMIT" ? 429 : error instanceof ProviderError && error.code === "NOT_CONFIGURED" ? 503 : 502; return NextResponse.json(publicProviderStatus(error), { status, headers: providerRetryHeaders(error) }); }
}
