# StakeMate Testnet deployment runbook

Deployment is **not approved or performed by this document**. It is a checklist for a separately authorized Testnet-only rehearsal. Never place recovery phrases, private keys, API secrets, or a package ID in source control.

## Preconditions

1. Obtain explicit deployment approval and complete an independent Move security review.
2. Use an isolated Testnet wallet/address with enough valueless Testnet SUI for package publication and subsequent test transactions. Do not use Mainnet credentials or funds.
3. Confirm the CLI and environment without printing key material:

```bash
sui --version
sui client active-env
sui client envs
```

Expected active environment is `testnet` and the active RPC must be a Sui Testnet endpoint.

4. From the repository root, rerun the local gates:

```bash
cd ~/stakemate/contracts/stakemate
sui move build
sui move lint
sui move test --statistics
sui move test --coverage
sui move coverage summary --test

cd ~/stakemate
npm run test
npm run lint
npm run build
```

## Gas planning

No reliable fixed gas estimate is asserted here: package publication cost varies with Testnet protocol configuration, package bytecode, and object state. Before approval, inspect the locally supported publish options:

```bash
sui client publish --help
```

This installed CLI supports `--dry-run`. After separate approval for a non-executing Testnet simulation, obtain a current estimate with:

```bash
sui client publish --dry-run
```

Set a deliberate gas budget only after reviewing that result. Do not treat faucet funds as a production cost model.

## Publish command — run only after approval

From `~/stakemate/contracts/stakemate`, with a reviewed budget replacing `<GAS_BUDGET_MIST>`:

```bash
sui client publish --gas-budget <GAS_BUDGET_MIST>
```

Record the transaction digest and package ID in the approved deployment record, not in committed source. Check the CLI output locally; do not claim success without it.

## Post-deployment verification

1. Use a Testnet explorer or trusted Testnet fullnode to confirm the publish transaction, package ID, and module named `challenge_escrow`.
2. Compare published module bytecode/source verification data with the reviewed commit and `sui move build` artifact.
3. Confirm no upgrade/admin capability has been introduced by the publish result or package configuration.
4. With two disposable Testnet addresses and a separate authority address, rehearse each path: exact funding, creator win, opponent win, tie/void, unfunded expiry refund, outcome expiry refund, and rejected unauthorized calls.
5. Verify emitted events, fixed recipient addresses, exact balances, and terminal-state rejections through a read-only explorer/fullnode query.
6. Keep frontend `escrowContractDeployed` false and all transaction builders inert until the deployment record, package verification, operational rehearsal, and separate frontend signing review are approved.

## Rollback and incident posture

There is no admin backdoor and existing challenges cannot be altered. If a deployment is unsuitable, do not point the frontend at it; publish a new reviewed Testnet package only with fresh approval. For any funded Testnet challenge, use the documented expiry recovery functions rather than attempting off-contract fund movement.
