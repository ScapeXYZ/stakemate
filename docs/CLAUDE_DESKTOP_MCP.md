# StakeMate MCP for Claude Desktop

StakeMate exposes an official Model Context Protocol TypeScript SDK server over stdio. It is deliberately read-only or preview-only: it cannot send invitations, sign a wallet request, transfer SUI, fund escrow, settle a challenge, or write to Walrus Memory.

## Claude Desktop configuration

Add the following to Claude Desktop's `claude_desktop_config.json`, then restart Claude Desktop. Adjust the repository path only if StakeMate is checked out elsewhere.

```json
{
  "mcpServers": {
    "stakemate": {
      "command": "/usr/bin/env",
      "args": ["bash", "/home/temitope/stakemate/scripts/run-stakemate-mcp-slot.sh", "chrome-temitope"]
    }
  }
}
```

The configuration intentionally contains no environment variables. Do **not** place `DATABASE_URL`, `FOOTBALL_DATA_API_TOKEN`, `TATUM_API_KEY`, Walrus credentials, session cookies, wallet keys, seed phrases, or a wallet address in the Claude configuration. Add a separate `opera-virus` server entry only after that wallet has completed its own browser pairing.

## Isolated-pilot wallet authorization

Public tools work without an identity. `stakemate_prepare_duel`, `stakemate_read_my_credibility`, and `stakemate_get_my_invitations` require an authenticated wallet-owner context. This flow is hard-locked to the disposable pilot database at `127.0.0.1:55435` and `http://localhost:3001`; it refuses all other database/origin combinations.

After authenticating with Slush and confirming the permanent username in Chrome (`@temitope`) or Opera (`@virus`), select **Connect AI Agent**. The site creates a one-time, five-minute pairing code bound to that server session, wallet, and immutable username. Only a SHA-256 hash is stored in the disposable database. The code is neither a wallet credential nor a transaction approval.

On the same trusted local machine, consume the displayed code through standard input—never as a command-line argument, in Claude chat, or in the Claude configuration:

```bash
read -r -s stakemate_pairing_code
printf '%s' "$stakemate_pairing_code" | npm run mcp:broker -- --slot chrome-temitope
unset stakemate_pairing_code
```

Use a distinct local slot such as `opera-virus` for the Opera wallet. The broker atomically consumes the code, writes a mode-`0600` context file, and issues a maximum 15-minute MCP context. Each private tool call rechecks the pairing’s wallet, session, expiry, and revocation status in the isolated database. **Disconnect / revoke** invalidates current and unconsumed pairings for that browser session immediately.

The stdio process accepts only an absolute, mode-`0600` context file authenticated with an HMAC key injected by the protected local broker process:

- `STAKEMATE_MCP_AUTH_CONTEXT_FILE`: absolute path to the short-lived, signed context file.
- `STAKEMATE_MCP_CONTEXT_HMAC_KEY`: broker-only HMAC secret.

The broker must issue the context only after a verified StakeMate wallet authentication, bind it to that wallet and its narrowly scoped permissions, and expire it promptly. Neither value belongs in Claude Desktop configuration. Without that broker context, private tools return `AUTHENTICATION_REQUIRED`; they never accept a caller-provided username as ownership proof and never inspect browser cookies.

The Claude Desktop process must receive the protected directory and HMAC key through the operating system’s local secret mechanism—not the MCP JSON configuration. For a slot-specific entry point, use `scripts/run-stakemate-mcp-slot.sh chrome-temitope`; it sets only the context-file path. The broker key is never sent through MCP, returned by a tool, or made browser-visible.

Security limitation: local stdio MCP is a same-OS-user trust boundary. A malicious process running as the same operating-system user can potentially interfere with another local desktop process. Use separate OS accounts for hostile-user isolation; browser profiles alone do not defend against same-user malware.

## Tools

| Tool | Access | Result |
| --- | --- | --- |
| `stakemate_resolve_username` | public | Public username only; no wallet, session, or credential data. |
| `stakemate_get_verified_fixtures` | public | Current football-data.org fixture data. |
| `stakemate_prepare_duel` | authenticated `duels:prepare` | A canonical, immutable-terms preview only. It needs explicit fixture ID and distinct 1X2 outcomes; natural language is context, never authority. |
| `stakemate_read_my_credibility` | authenticated `credibility:read` | Validated Walrus Memory recall and provenance for the bound wallet only. |
| `stakemate_get_my_invitations` | authenticated `invitations:read` | Read-only invitation audit summaries for the bound wallet only. |

For a duel preview, the caller must provide a registered recipient, a currently eligible real fixture, exact Home/Draw/Away selections, stake, and expiry. Ambiguous fixtures or outcomes fail closed. The preview shows the canonical terms hash and the draw rule: for opposing home/away predictions, a full-time draw returns 100% of each escrow principal; unavoidable network gas remains separate.

Walrus recall validates the canonical schema and returns provenance. It does not fabricate a score, and this server never performs a Walrus write. Tatum Sui RPC is server-side and read-only with explicit Mainnet/Testnet selection; none of these five tools needs a chain read, so it is intentionally not invoked implicitly.

## Local verification

```bash
npm run mcp:stdio
npm test -- --test-name-pattern='MCP'
npm run build
```

The first command waits for an MCP client on standard input; standard output is reserved exclusively for protocol messages. Diagnostic logs go to standard error.
