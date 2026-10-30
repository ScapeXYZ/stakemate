# Verified market provider plan

StakeMate has **no configured sports or crypto provider**. The application must not display a fixture, price, result, probability, or market as live until an approved server-side adapter has fetched and validated it. Creation and funding are intentionally disabled.

## Approved read-only sports provider: football-data.org v4

Candidate scope: upcoming football fixtures only, with the provider's immutable match ID, competition name, team names, UTC kickoff, provider status, retrieval timestamp, and request provenance retained in immutable invitation terms. Its documented match statuses distinguish `SCHEDULED`/`TIMED` from finished, postponed, cancelled, and suspended states; StakeMate would admit only mapped `SCHEDULED` and `TIMED` fixtures. The API documents an `X-Auth-Token` server-side credential, free-plan throttling of 10 requests/minute, and paid-plan rates of 30 or 60 requests/minute. It also documents access restrictions and HTTP 429 behavior. [API policies](https://docs.football-data.org/general/v4/policies.html) and [match statuses](https://docs.football-data.org/general/v4/match.html).

StakeMate's read-only adapter supports only Premier League (`PL`), Primera División / La Liga (`PD`), and UEFA Champions League (`CL`). It uses `/v4/competitions/{code}/matches` with UTC `dateFrom` and `dateTo` filters, returns only future `TIMED` and `SCHEDULED` records, and marks `SCHEDULED` records display-only. It never creates an invitation or settles an outcome. `TIMED` is merely technically eligible for later review—not permission to activate funding.

The free tier is limited to 10 requests/minute. StakeMate uses one server request at least 6.5 seconds apart per process and a 45-second in-process success cache. This is not distributed rate limiting; a multi-instance deployment needs shared caching/rate limiting before scale-out. Provider outages, 401/403 access rejection, 429 limits, timeouts, malformed data, or stale data fail closed with no fixture substitution. [Provider policy](https://docs.football-data.org/general/v4/policies.html) and [match-resource documentation](https://docs.football-data.org/general/v4/match.html).

Store `FOOTBALL_DATA_API_TOKEN` only in the server secret manager. Before any commercial launch or use in a prediction market, obtain written confirmation of: plan coverage for PL/PD/CL, display attribution requirements, fixture/result redistribution rights, team-name and crest/logo rights, rate limits, costs, uptime/SLA, correction policy, and whether the data license permits prediction-market or betting-adjacent use. Team logos are intentionally not fetched or displayed. Provider data must not be copied to Walrus or other permanent storage until retention, redistribution, and licensing rights are reviewed.

## Candidate crypto source: selection required

No crypto provider has been selected or integrated. The selected source must provide a stable instrument ID, pair and quote currency, timestamped observations or historical candles, rate-limit and retention terms, and a documented correction policy. A single latest-price endpoint is insufficient for a time-window settlement.

The adapter contract requires a decimal price string, exact UTC observation timestamp, provider/instrument ID, pair, and quote currency. For every market, immutable terms must name the source, source instrument ID, UTC observation window, threshold, and strict or inclusive comparison. A second independent source is required for settlement cross-checking where feasible.

## Adapter and settlement gates

`src/lib/server/market-providers.ts` exposes server-only interfaces and a disabled registry. A concrete adapter must:

- authenticate only from server-side environment variables;
- enforce a bounded request timeout, provider rate limiting, and safe error mapping;
- reject stale, missing, completed, postponed, cancelled, malformed, or future-dated source records;
- retain source ID, query parameters/window, observed value, and UTC timestamps as settlement evidence;
- route postponement/cancellation/abandonment to the agreed void/refund rule;
- route missing or conflicting final data to dispute then the pre-agreed refund route if unresolved; and
- pass a review using real provider responses before `creationEnabled` can change.

No AI component may generate fixtures, prices, results, or authorize settlement. The named outcome authority remains responsible for publishing the verified result, and any later Walrus evidence write remains separately approval-gated.
