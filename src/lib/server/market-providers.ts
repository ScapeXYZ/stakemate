import { z } from "zod";
import { ProviderError } from "@/lib/server/errors";
import { validateUpcomingFixture, type VerifiedFixture } from "@/lib/outcome-verification";

/** Server-only contracts. No provider is instantiated until its credentials and source policy are approved. */
export type UpcomingFixtureProvider = {
  readonly providerId: string;
  readonly provenance: string;
  listUpcomingFixtures(input: { fromUtc: string; toUtc: string }): Promise<readonly VerifiedFixture[]>;
};

export type VerifiedCryptoMarket = {
  provider: string;
  instrumentId: string;
  pair: string;
  quoteCurrency: string;
  observedAtUtc: string;
  price: string;
};

export type CryptoPriceProvider = {
  readonly providerId: string;
  readonly provenance: string;
  priceAtOrWithin(input: { instrumentId: string; pair: string; quoteCurrency: string; observationStartUtc: string; observationEndUtc: string }): Promise<VerifiedCryptoMarket>;
};

const cryptoMarketSchema = z.object({ provider: z.string().min(1), instrumentId: z.string().min(1), pair: z.string().min(3), quoteCurrency: z.string().min(1), observedAtUtc: z.string().datetime({ offset: true }), price: z.string().regex(/^\d+(?:\.\d+)?$/) });

/** Reject malformed, stale, completed, or fictional fixture payloads before they reach invitation terms. */
export function validateProviderFixtures(fixtures: readonly VerifiedFixture[], nowMs = Date.now()) {
  return fixtures.map((fixture) => {
    const failure = validateUpcomingFixture(fixture, nowMs);
    if (failure) throw new ProviderError(`Fixture verification failed: ${failure}`, "INVALID_RESPONSE");
    if (Date.parse(fixture.verifiedAtUtc) > nowMs || nowMs - Date.parse(fixture.verifiedAtUtc) > 5 * 60_000) throw new ProviderError("Fixture provider response is stale.", "INVALID_RESPONSE");
    return fixture;
  });
}

export function validateCryptoMarket(value: unknown, nowMs = Date.now(), maxAgeMs = 60_000): VerifiedCryptoMarket {
  const market = cryptoMarketSchema.parse(value);
  const observed = Date.parse(market.observedAtUtc);
  if (observed > nowMs || nowMs - observed > maxAgeMs) throw new ProviderError("Crypto provider response is stale.", "INVALID_RESPONSE");
  return market;
}

class DisabledFixtureProvider implements UpcomingFixtureProvider {
  readonly providerId = "unconfigured"; readonly provenance = "No provider configured";
  async listUpcomingFixtures(_input: { fromUtc: string; toUtc: string }): Promise<readonly VerifiedFixture[]> { throw new ProviderError("Sports fixture provider is not configured.", "NOT_CONFIGURED"); }
}
class DisabledCryptoProvider implements CryptoPriceProvider {
  readonly providerId = "unconfigured"; readonly provenance = "No provider configured";
  async priceAtOrWithin(_input: { instrumentId: string; pair: string; quoteCurrency: string; observationStartUtc: string; observationEndUtc: string }): Promise<VerifiedCryptoMarket> { throw new ProviderError("Crypto price provider is not configured.", "NOT_CONFIGURED"); }
}

/** Explicitly disabled registry. Replacing either adapter requires a reviewed provider-specific implementation. */
export const verifiedMarketProviders = { sports: new DisabledFixtureProvider(), crypto: new DisabledCryptoProvider(), creationEnabled: false as const };
