# Isolated two-wallet invitation pilot audit

Scope: localhost-only PostgreSQL 17 container, tmpfs data directory, synthetic
wallet addresses, and no imported database data, sessions, or credentials.
The test identities are `@temitope` and `@Virus` only within this disposable
database. They are bound to deterministic synthetic addresses and are not the
real public-wallet accounts.

| Scenario | Required audit sequence | Evidence |
| --- | --- | --- |
| Create → send → accept | `pending` → `accepted` | Core hash, accepted challenge hash, recipient-wallet snapshot, and separate funding deadline are read back from the party inbox. No funding is requested. |
| Duplicate acceptance | `accepted` → same `accepted` record | Repeating the same actor/action/idempotency key returns the stored commitment; a distinct duplicate action is refused by the conditional transition. |
| Create → send → reject | `pending` → `rejected` | Party inbox returns the terminal rejection record. |
| Expiration | `pending` → `expired`; acceptance refused | Disposable PostgreSQL test advances an already-expired synthetic row and verifies the database-time conditional update refuses acceptance. |
| Fixture change | acceptance refused | Unit revalidation test changes kickoff/team identity and receives `FIXTURE_CHANGED` before the lifecycle transition. |
| Immutable commitment | mutation refused | Database trigger rejects tampering with core or accepted challenge evidence. |

The accompanying test suite performs no authentication signature, wallet
transaction, SUI transfer, funding, settlement, or Walrus operation.
