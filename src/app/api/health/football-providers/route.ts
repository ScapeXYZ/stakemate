import "server-only";
import { NextResponse } from "next/server";
import { getFootballDataClient } from "@/lib/server/football-data";
import { ProviderError } from "@/lib/server/errors";
import { getSportmonksSecondaryClient } from "@/lib/server/sportmonks-football";

export const runtime = "nodejs";

type ProbeFailure = { configured: "empty" | "non_empty"; authenticated: false; httpStatus: number | null; subscriptionAccess: "not_evaluated" | "rejected" | "unavailable"; fixtureCoverage: "not_evaluated"; errorCode: string };

function failure(configured: ProbeFailure["configured"], error: unknown): ProbeFailure {
  const provider = error instanceof ProviderError ? error : undefined;
  return {
    configured,
    authenticated: false,
    httpStatus: provider?.status ?? null,
    subscriptionAccess: provider?.code === "AUTH" ? "rejected" : provider?.code === "NOT_CONFIGURED" ? "not_evaluated" : "unavailable",
    fixtureCoverage: "not_evaluated",
    errorCode: provider?.code ?? "UPSTREAM",
  };
}

/**
 * Public-safe, read-only server-runtime probe. It deliberately returns only
 * derived configuration and provider-access state; credentials never leave the
 * server, are never logged, and are not included in errors.
 */
export async function GET() {
  const footballDataConfigured = process.env.FOOTBALL_DATA_API_TOKEN?.trim() ? "non_empty" as const : "empty" as const;
  const sportmonksConfigured = process.env.SPORTMONKS_API_TOKEN?.trim() ? "non_empty" as const : "empty" as const;
  const [footballData, sportmonks] = await Promise.all([
    footballDataConfigured === "empty"
      ? Promise.resolve(failure("empty", new ProviderError("Football fixture provider is not configured.", "NOT_CONFIGURED")))
      : getFootballDataClient().upcoming("PL").then((response) => ({ configured: "non_empty" as const, authenticated: true as const, httpStatus: 200, subscriptionAccess: "PL fixtures" as const, fixtureCoverage: { competition: "PL", upcomingFixtureCount: response.fixtures.length } })).catch((error: unknown) => failure("non_empty", error)),
    sportmonksConfigured === "empty"
      ? Promise.resolve(failure("empty", new ProviderError("Sportmonks secondary football provider is not configured.", "NOT_CONFIGURED")))
      : getSportmonksSecondaryClient().health().then((response) => ({ configured: "non_empty" as const, authenticated: response.authenticated, httpStatus: response.httpStatus, subscriptionAccess: "fixtures-by-date" as const, fixtureCoverage: { date: response.checkedAtUtc.slice(0, 10), fixtureCount: response.fixtureCount } })).catch((error: unknown) => failure("non_empty", error)),
  ]);
  const ok = footballData.authenticated && sportmonks.authenticated;
  return NextResponse.json({ ok, footballData, sportmonks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
