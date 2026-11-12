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

The default suite covers Rust, client libraries, service agents, request and workspace handling, actual contract Wasm and compatibility with the earlier client contract.

Browser tests run against local contract Wasm and deterministic service fixtures:

```sh
npx playwright install chromium
npm run test:e2e -- --local
```

The browser runner starts its own local services. Run it in an environment that allows loopback listeners and Chromium. Generated accounts, transaction journals and browser state are stored under `.local/`.

Individual suites are available as `test:unit`, `test:wasm`, `test:services`, `test:security` and `test:legacy`.

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

The test token has no monetary value. Mainnet owner routing is configured separately through the [Intents SDK](../packages/intents/README.md).

## SDK packages

Build the SDKs with `npm run build:v4`. Their package READMEs document installation and usage:

- [Client SDK](../packages/client/README.md)
- [Owner-routing SDK](../packages/intents/README.md)

Runtime state and generated build, browser and deployment records stay in ignored `target/` and `.local/` directories.
