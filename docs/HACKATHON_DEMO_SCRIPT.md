# StakeMate — final demo timeline

Target duration: **2:55**. The official limit is 2–3 minutes. Record the narration, screen capture, and subtitles from this same timeline so the three tracks stay aligned. Use real application footage and the public-safe evidence files only. Never show secrets, private receipts, or a fabricated payout.

| Time | Screen action | Exact narration / subtitle text |
| --- | --- | --- |
| 0:00–0:14 | Two friends discussing a football fixture; no logo animation. | “Every football fan has been here. You and your friend disagree about who will win a match. You make your prediction, agree on a stake, and suddenly the question becomes: who will actually honour the agreement?” |
| 0:14–0:29 | Open the real StakeMate landing page and fixture view. | “That’s why we built StakeMate. Instead of relying on trust or using another betting platform, two friends can create a prediction duel and secure their agreement through Sui smart-contract escrow.” |
| 0:29–0:48 | Show fixture selection, prediction choice, stake, opponent, and duel preview. | “A friend selects an eligible football fixture, chooses a prediction, agrees the exact stake, selects an opponent, and creates the duel. The terms include the teams, kickoff, deadlines, and a draw-or-void refund rule.” |
| 0:48–1:01 | Show invitation review in the isolated pilot, labelled “isolated pilot”. | “In the isolated pilot, the opponent can review the invitation and accept, reject, or let it expire. Production invitation registration is not enabled in this deployment, so this screen is shown only as pilot evidence.” |
| 1:01–1:31 | Show public-safe Testnet evidence card and transaction explorer pages. Hold each digest long enough to read. | “The escrow rule is enforced on-chain. Creation succeeded in `692yvYU41xC3JhN48N3kD1Ed3n5SgvLTEu7Vr72fUqQb`. Exact funding succeeded in `EGAd7GZotSEJJGB53bzhk8BRFtqvvdWETZyVxWVPwCCS`. Underpayment and overpayment were both rejected with `E_WRONG_STAKE`: 999,999 and 1,000,001 MIST. The contract, not only the frontend, enforces the exact amount.” |
| 1:31–1:47 | Show football-data.org completed fixture `560620`; then a clearly labelled “Sportmonks not configured” card. | “For outcomes, StakeMate is designed to compare football-data.org with Sportmonks. Independent sources matter because an uncertain result should not settle a duel. football-data.org returned completed fixture `560620` with a 1–1 result. Sportmonks is not configured, so live dual-provider agreement has not been proven.” |
| 1:47–2:07 | Show the correction-window and settlement architecture diagram, with “under development” label. | “The intended worker waits through a correction window, checks the verified result, reconciles the on-chain state, and retries safely. Unattended settlement broadcasting remains under development: there is no reviewed secure signer or successful settlement rehearsal, so this demo shows no automatic payout.” |
| 2:07–2:27 | Show the redacted Walrus evidence manifest and the 10-record verification summary. | “Walrus Memory preserves context for the AI-assisted experience: relevant duel and verification history can remain portable across interactions. The historical Mainnet batch has ten completed receipts, ten distinct blob IDs, ten aggregator HTTP 200 retrievals, and ten canonical recall matches. New writes are disabled.” |
| 2:27–2:42 | Show the Tatum evidence card: Testnet chain ID, package, publish transaction. | “Tatum provides the read-only Sui Testnet RPC boundary. StakeMate verifies the chain, the pinned `challenge_escrow` package, and its successful publish transaction through gRPC. Tatum supports verification; it does not sign or submit payouts.” |
| 2:42–2:55 | Show a final status card: current / roadmap / safety boundaries, plus GitHub and live-app URLs. | “StakeMate is a friendly way for two people to settle a football argument using Sui on-chain escrow. Football is current. Crypto and stock duels, automated settlement, dual-provider live agreement, expanded memory, and AI-assisted duel management are roadmap items—not launched features.” |

## Production checks

- Keep the narration and subtitles verbatim; subtitle each sentence in readable two-line captions.
- Do not speed up the footage. Hold transaction evidence for legibility and blur only unrelated personal information.
- Label isolated-pilot, historical, roadmap, and under-development scenes visibly.
- Use restrained music only after the opening problem is established; keep it below the voice.
- Before upload, verify duration is 2–3 minutes, the opening/middle/ending play, voice is clear, captions match, and no unsupported claim or secret appears.
