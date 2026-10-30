# StakeMate demo and submission checklist

## Two-wallet isolated-pilot demonstration

- [ ] Start only the disposable, loopback PostgreSQL 17 service and verify the pilot invariants in `ISOLATED_REAL_TWO_WALLET_PILOT.md`.
- [ ] Bind the app to `127.0.0.1:3001`; confirm maintenance writes are disabled everywhere except this disposable process and Walrus writes are `false`.
- [ ] In separate browser profiles, connect two Testnet wallets and approve only the readable StakeMate personal-message authentication prompt.
- [ ] Claim two permanent handles, discover a provider-backed `TIMED` fixture, and create an off-chain invitation with exact terms.
- [ ] As the recipient, inspect the read-only audit evidence and accept or reject. Confirm that no funding/signing/transaction request appears.
- [ ] Create a separate invitation and let it expire naturally; show that acceptance fails closed. Do not alter database timestamps.

## Walrus and agent demonstration

- [ ] Show the frozen batch as ten manifest entries with ten completed receipts.
- [ ] Run only read-only recall and show that all returned records must match the manifest digest and receipt; do not call this new publication.
- [ ] Show the authenticated wallet's Memory History/Agent Insights result. If current canonical invitation commitments do not match historic records, show “insufficient evidence,” not ownership, outcomes, or accuracy.
- [ ] Pair a local Claude Desktop MCP client with a one-time local broker code. Demonstrate fixture lookup, a preview-only draft, and wallet-scoped read-only history. Do not place pairing codes or secrets in a prompt/configuration.
- [ ] State that remote MCP and ChatGPT-plugin installation are not enabled.

## Submission readiness

- [ ] Capture the provider, wallet, and Walrus evidence without secrets, addresses beyond the intended public demo, or fabricated outcomes.
- [ ] Include the architecture and safety boundaries from the README.
- [ ] State validation results and all skipped live/disposable integration tests.
- [ ] Do not claim a deployed URL, Sui transaction, Walrus publication, official ChatGPT approval, or football result unless independently demonstrated.

## External requirements before public deployment

- Managed PostgreSQL with TLS, migrations, backups, least-privilege credentials, and a transactional shared Walrus receipt store.
- Production football-data.org and Tatum credentials in a secret manager, plus monitoring and rate limiting.
- Public HTTPS origin, reviewed OAuth 2.1 issuer/JWKS/PKCE/consent/revocation flow, and MCP abuse/rate-limit/audit controls before remote MCP can be enabled.
- A separately approved security review and explicit policy decision for any funding, signing, invitation mutation, settlement, or Walrus publication.
