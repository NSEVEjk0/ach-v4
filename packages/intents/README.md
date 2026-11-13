# ACH owner-routing SDK

Cross-chain quotes, owner-controlled funding and payouts using NEAR Intents.

## Install

Download both packages from the [developer page](https://ach-rosy.vercel.app/developers):

```sh
npm install ./ach-client-4.0.1.tgz ./ach-intents-4.1.0.tgz
```

The client is a peer dependency. These packages are distributed as tarballs and are not published to npm.

Version 4.1.0 expands catalogue asset validation to NEP-245 and Chain Signatures identities while retaining the compatible `^4.0.0` client peer range. The current client download is 4.0.1. The earlier 4.0.0 archives remain available for existing integrations.

`OneClickIntents` provides token discovery, quotes and route status. `OwnerIntentsRouter` from `@ach/intents/owner` uses an owner client connected to a separately configured mainnet vault.

Token discovery accepts the catalogue's `nep141:`, `nep245:` and `1cs_v1:` asset identities. Token decimals come from the catalogue; amounts are integer base units, not floating-point token values. Discovery and quote validation support more assets than the built-in execution adapters.

## Prepare and execute a route

```js
import { OneClickIntents } from '@ach/intents';
import {
  OwnerIntentsRouter,
  NearTokenRouteSender,
  destinationReceiptVerifier,
} from '@ach/intents/owner';

const api = new OneClickIntents();
const verify = destinationReceiptVerifier(await api.tokens(), {
  nearRpc: 'https://rpc.mainnet.near.org',
  baseRpc: 'https://mainnet.base.org',
  baseConfirmations: 12,
});
const router = new OwnerIntentsRouter(
  ownerClient, api, persistentRouteStore, verify
);

const route = await router.prepare(requestId, 'payout', request);
// Obtain the owner's approval of the exact route.approval_hash.
await router.execute(
  route.id, approvedHash, new NearTokenRouteSender(ownerClient)
);
const status = await router.refresh(route.id);
```

The request binds the assets, recipient, refund owner, amount and deadline. A changed quote or token identity requires a new route and owner approval.

## Funding and payouts

Funding first reaches the owner's NEAR account. A confirmed destination receipt permits a separate authenticated deposit into ACH.

A payout first withdraws from ACH to the owner, then sends the exact approved quote. The source sender retains its signing key and records signed bytes before broadcast.

Base source signing uses the `SourceSender` interface. Supply an owner-operated sender that durably records its transaction under the provided operation ID and recovers lost responses without another transfer.

The built-in `destinationReceiptVerifier` supports **NEAR and Base only**. It does not independently verify destination payments on every chain listed by 1Click. Additional executed routes require a chain-specific source sender where needed and a custom destination verifier that binds the actual chain, token, recipient, amount and transaction to the approved quote. Broad token discovery or a successful dry quote is not execution support.

Implement `reconcileExactQuote` to observe a previously signed source transaction after quote expiry without broadcasting again. The NEAR sender uses the client's read-only transaction reconciliation. An untouched expired quote cannot execute.

## Route state

Router instances sharing a store serialize preparation, execution, refresh and deposit for each route. Separate processes require an exclusive store writer and coordinated source signing.

A successful 1Click status still requires a confirmed destination receipt binding the chain, token, amount, recipient and transaction. Base defaults to twelve confirmations. Refunds, incomplete deposits, uncertain broadcasts and expired quotes retain separate states.

An ACH deposit is capped at the route's quoted output. Surplus received by the owner stays outside ACH. API and receipt RPC calls reject redirects and enforce bounded responses; configured receipt RPCs require HTTPS without embedded credentials.

## Browser quote previews

The hosted app uses sponsored NEAR test funds and previews mainnet routes from a selected catalogue asset into pinned NEAR USDC, or from NEAR USDC into the selected asset. The chain and token pickers use the live catalogue and retain token decimal precision. There are 48 quote previews per workspace; liquidity and minimum amounts depend on the provider.

The browser sends no cross-chain transfer. ACH mainnet deployment and execution remain deferred; executing a separately configured owner route requires funded accounts and explicit owner approval. XRP destinations with tags must use X-address encoding; separate classic-address tags are unsupported. Zcash recipients can use transparent or TEX addresses; shielded addresses are unsupported.

Dry quotes have no deposit address and cannot credit ACH. NEAR Intents does not provide an official testnet.

See the [client SDK](../client/README.md) for wallet and signer setup.
