import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "../src/lib/server/errors";
import { validateCryptoMarket, validateProviderFixtures, verifiedMarketProviders } from "../src/lib/server/market-providers";

const now = Date.parse("2030-01-01T00:00:00.000Z");

test("unconfigured market providers cannot populate upcoming markets", async () => {
  assert.equal(verifiedMarketProviders.creationEnabled, false);
  await assert.rejects(() => verifiedMarketProviders.sports.listUpcomingFixtures({ fromUtc: "2030-01-01T00:00:00.000Z", toUtc: "2030-01-02T00:00:00.000Z" }), (error: unknown) => error instanceof ProviderError && error.code === "NOT_CONFIGURED");
  await assert.rejects(() => verifiedMarketProviders.crypto.priceAtOrWithin({ instrumentId: "BTC-USD", pair: "BTC/USD", quoteCurrency: "USD", observationStartUtc: "2030-01-01T00:00:00.000Z", observationEndUtc: "2030-01-01T00:01:00.000Z" }), (error: unknown) => error instanceof ProviderError && error.code === "NOT_CONFIGURED");
});

test("provider validation rejects completed, stale, and malformed market payloads", () => {
  assert.throws(() => validateProviderFixtures([{ provider: "provider", fixtureId: "1", league: "League", homeTeam: "A", awayTeam: "B", scheduledKickoffUtc: "2029-12-31T12:00:00.000Z", status: "scheduled", verifiedAtUtc: "2030-01-01T00:00:00.000Z" }], now), ProviderError);
  assert.throws(() => validateProviderFixtures([{ provider: "provider", fixtureId: "1", league: "League", homeTeam: "A", awayTeam: "B", scheduledKickoffUtc: "2030-01-02T12:00:00.000Z", status: "scheduled", verifiedAtUtc: "2029-12-31T23:50:00.000Z" }], now), ProviderError);
  assert.throws(() => validateCryptoMarket({ provider: "price", instrumentId: "BTC-USD", pair: "BTC/USD", quoteCurrency: "USD", observedAtUtc: "2029-12-31T23:58:00.000Z", price: "1" }, now), ProviderError);
});
