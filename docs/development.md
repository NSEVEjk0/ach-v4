# Development

Run commands from the repository root unless noted otherwise.

## Requirements

- Node 22.22.2 or newer.
- Rust and the Wasm targets specified in [rust-toolchain.toml](../rust-toolchain.toml).
- Chromium for browser tests.

## Install and build

```sh
npm ci
npm run setup
npm run build
```

Setup installs the package-specific dependencies. The build compiles the protocol library, Rust vault and test token, OutLayer worker, client SDKs and web app. Wasm artifacts and the build manifest are written under `target/`.

## Tests

```sh
npm test
```

The default suite covers Rust, client libraries, service agents, request and workspace handling, actual contract Wasm and the repository's clearing implementations.

Browser tests run against local contract Wasm and deterministic service fixtures:

```sh
npx playwright install chromium
npm run test:e2e -- --local
```

The browser runner starts its own local services. Run it in an environment that allows loopback listeners and Chromium. Generated accounts, transaction journals and browser state are stored under `.local/`.

Individual suites are available as `test:unit`, `test:wasm`, `test:services` and `test:security`.

Focused coverage for judge tests, provisioning, private batching and catalogue routes:

```sh
node --test services/test/netting-test.test.mjs services/test/sponsor.test.mjs services/test/private-commerce.test.mjs services/test/intents.test.mjs
node --test --experimental-test-isolation=none tests/v4/intents-ui.test.mjs
```

These offline tests exercise signer checks, restart reconciliation, complete-group private verification, quote validation and token precision. Local contract Wasm and deterministic worker fixtures are not evidence of a live chain transaction, measured gas use or wallet setup speed. Verify live behavior through a fresh testnet workspace and its final receipts before making those claims.

## Frontend

```sh
cp web/.env.example web/.env.local
npm run dev --prefix web
```

The frontend runs at `http://localhost:3000`. Set the coordinator URL and service token to the values from your own backend's private configuration. Wallet and work views need a running coordinator.

A hosted backend can use signed gateway discovery instead of a direct coordinator URL. Configure `ACH_V4_DISCOVERY_URL`, `ACH_V4_DISCOVERY_KEY`, `ACH_V4_NETWORK` and `ACH_V4_VAULT` together so discovery is pinned to the expected deployment.

## Backend

The [public app](https://ach-rosy.vercel.app) already has a sponsored testnet backend. To operate a separate instance, use a fresh private deployment directory:

```sh
node scripts/create-testnet.mjs --private-root .local/my-deployment
node scripts/deploy-contract.mjs --private-root .local/my-deployment
```

These commands create and deploy fresh NEAR testnet accounts. They write the manifest, signers and transaction journals into the chosen private directory.

Configure planner and private-worker credentials in that deployment's private environment before starting the services:

```sh
node scripts/deploy-contract.mjs --private-root .local/my-deployment --outlayer
node scripts/deploy-contract.mjs --private-root .local/my-deployment --services
```

The service launcher requires Linux with systemd and a `cloudflared` binary in the private deployment directory. It creates an isolated unit and ports for the deployment. Keep its manifest, signer files, environment and journals together across restarts. Reconcile a recorded operation before retrying it.

The test token has no monetary value. ACH mainnet deployment and execution are deferred. Browser Intents requests use mainnet dry quotes; the separate [Intents SDK](../packages/intents/README.md) documents owner routing and its current receipt-verifier boundaries.

### Check operating funds

Native test NEAR pays transaction fees, sponsored account storage and OutLayer computation. It is separate from the nonmonetary tUSDC used for agent balances and net settlement. Inspect a deployed testnet namespace without reading keys or sending transfers:

```sh
node scripts/v4/check-funding.mjs --private-root .local/my-deployment
```

The JSON report shows available native balances after storage, recommended operating thresholds for the sponsor, coordinator and vault, and the configured sponsorship reservation cap. It includes refill suggestions only when a balance is low. You can use `ACH_V4_PRIVATE_ROOT` instead of the flag; `--manifest PATH` optionally selects another manifest within your chosen deployment setup.

Additional faucet funding uses an explicit batch number:

```sh
node scripts/create-testnet.mjs --refill-sponsor --refill-batch 1 --private-root .local/my-deployment
```

Each batch transfers free test NEAR from three fresh faucet accounts. Repeating a batch reconciles its recorded transfers. The default batch is zero; use a different number for another allocation.

### Prepared judge wallets

Configure `sponsor_limits.preparedWorkspaces` in the private deployment manifest:

```json
[{ "agent_count": 3, "ready": 4 }, { "agent_count": 12, "ready": 4 }]
```

The sponsor prepares each workspace with distinct owner and trading keys, confirmed native operating funds and credited test-token balances. A ready workspace is assigned to one visitor without another chain transaction. Tokens are rotated at assignment, family ownership is retained, and unused pool entries cannot authenticate or enter coordinator audits. Replenishment stays within the sponsor budget. If no prepared workspace is ready, normal provisioning resumes.

A prepared twelve-wallet workspace can serve smaller requested tests; the selector retains the requested agent count. Its spending policies keep their original expiry, shown in the workspace. New larger workspaces credit all wallets with 5 tUSDC and allow 100 tUSDC of gross purchases per agent. The default three-service workspace retains Research's 1 tUSDC balance and zero starting balances for Visual and Audit.

### Private funded-group batching

Set `private.batch_funded_invoices = true` in the private deployment configuration to stage the commerce workflow's three signed encrypted invoices for one OutLayer verification/netting run. This is opt-in. Persist the agent, coordinator and private-job stores together: the selected verification mode stays attached to each invoice so an in-progress receipt workflow continues its original path after restart. The browser only releases encrypted results after the complete funded group is READY or SETTLED on chain.

### Test larger groups from the UI

Open Clearing → **Test netting with more agents**, choose 3–12 agents and public or private bills, prepare a fresh judge workspace if prompted, then run the signed test. Inspect its round and balances after settlement. Public tests always leave a 0.020 tUSDC net payment. Private tests use at most six bills; at twelve agents the six pairs have no offsetting payments and settle 0.500 tUSDC.

Fresh judge workspaces receive real sponsored testnet accounts with separate trading keys. Larger workspaces fund every participant with 5 tUSDC. Workspace limits include twelve synthetic netting tests, 48 quote previews, the trading-policy expiry and the configured contract, spending and sponsor budgets. Settings can reopen earlier unexpired workspaces or create a new one.

## SDK packages

Build the SDKs with `npm run build:v4`. Their package READMEs document installation and usage:

- [Client SDK](../packages/client/README.md)
- [Owner-routing SDK](../packages/intents/README.md)

Runtime state and generated build, browser and deployment records stay in ignored `target/` and `.local/` directories.
