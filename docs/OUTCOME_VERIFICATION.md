# Verified-event and settlement policy

StakeMate does not permit challenge creation from demo, fictional, completed, postponed, or unverified events. No sports or crypto provider is configured in this workspace, so the UI disables challenge creation.

## Sports

A fixture adapter must return a reputable/licensed provider name, immutable provider fixture ID, league, both team names, scheduled UTC kickoff, retrieval timestamp, and an eligible upcoming status (`scheduled` or `timed`). The client rejects anything missing these fields or whose kickoff is not future UTC.

Before acceptance, immutable terms must name the exact market (`home_win`, `draw`, or `away_win`), two independent result sources where feasible, the outcome authority, deadline, and rule: final matching scores settle; draw is a normal market outcome; postponed, cancelled, or abandoned matches void and return both principals; missing or conflicting final sources enter dispute and then the pre-agreed void/refund path if unresolved by the outcome deadline.

## Crypto

Terms must specify asset/pair, quote currency, named price sources, observation timestamp/window in UTC, maximum feed age, numeric threshold, and one comparison rule (`above`, `at_or_above`, `below`, or `at_or_below`). Two fresh matching observations are required. Stale/missing feeds void/refund; conflicting pairs or values dispute. Equality is only a win for inclusive rules.

## Settlement evidence

The trusted outcome authority—not an AI agent—may publish a Sui outcome. It must retain provider/source IDs, observed values, UTC timestamps, query/window, result evidence, and correction history. AI may summarize evidence only. On verification failure, the pre-agreed dispute/void path preserves valid principals; Sui gas is not part of refunded stake principal. Genuine evidence may be written to Walrus only under separately approved write controls.

## Provider dependency

Integrate a licensed or reputable fixture provider and price feeds with historical/timestamped access before enabling creation. Define source contracts, rate limits, retention, correction handling, and independent cross-check availability. Never make a live-event claim until an adapter validates it.

See [MARKET_PROVIDERS.md](MARKET_PROVIDERS.md) for the disabled server-adapter contracts, football-data.org candidate requirements, and crypto-provider selection criteria.

The football-data.org adapter exposes a separate read-only result record for manual evidence review. It has `settlementEnabled: false`: it does not determine a winner, call the Move contract, write Walrus, or change any invitation/funding status.

## 1X2 draft rule

A football duel draft is preview-only. Both participants have named, distinct selections from `home_win`, `draw`, and `away_win`; no "opposite" is inferred. The one remaining, unselected outcome is written explicitly into canonical terms and causes a full-principal refund. A future invitation must require the named opponent to explicitly accept the same immutable terms before any funding deadline is set. The deployed escrow contract has only creator-win, opponent-win, and void outcomes, so this three-outcome mapping is compatible only through the explicit third-outcome void rule; it is not a binary market.

Before rendering a draft preview, StakeMate re-fetches the provider fixture by ID and accepts it only if it remains future and `TIMED`. `SCHEDULED` records remain display-only. The preview is not an invitation, is not persisted, and cannot be funded or signed.
