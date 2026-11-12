# ACH owner routing

Install the downloaded `ach-client-4.0.0.tgz` and `ach-intents-4.0.0.tgz`
together. The client is a peer dependency; these packages are not on npm.

`OneClickIntents` provides token discovery, validated quotes and raw route
status. `OwnerIntentsRouter` from `@ach/intents/owner` runs only with an owner
client on a separately configured mainnet vault.

Incoming funds first reach the owner's NEAR account. The independently verified
receipt permits a separate authenticated token deposit into ACH. A payout first
withdraws to the owner, then sends the exact approved quote. The source sender
retains its own key and journals signed bytes before broadcast.

```js
import {OneClickIntents} from '@ach/intents';
import {
  OwnerIntentsRouter,NearTokenRouteSender,destinationReceiptVerifier,
} from '@ach/intents/owner';

const api=new OneClickIntents();
const verify=destinationReceiptVerifier(await api.tokens(),{
  nearRpc:'https://rpc.mainnet.near.org',baseRpc:'https://mainnet.base.org',
  baseConfirmations:12,
});
const router=new OwnerIntentsRouter(ownerClient,api,persistentRouteStore,verify);
// request includes exact assets, recipient/refund owner, amount and deadline.
const route=await router.prepare(requestId,'payout',request);
// Obtain the owner's approval of route.approval_hash before executing.
await router.execute(route.id,approvedHash,new NearTokenRouteSender(ownerClient));
const status=await router.refresh(route.id);
```

Base source signing uses the `SourceSender` interface. Supply an owner-operated
sender that durably records its transaction under the provided operation ID;
it must recover a lost response without a second transfer. There is no hosted
Base signing service in the free demo.
Implement `reconcileExactQuote` to observe previously signed source transactions
after quote expiry, without broadcasting. The NEAR sender uses the client's
read-only transport reconciliation. An untouched expired quote cannot execute,
including when a pending withdrawal finishes after its deadline.

Router instances sharing the same store serialize each route's preparation,
execution, refresh and deposit. Separate processes require an exclusive store
writer and coordinated source signing. The approval hash includes the complete
request and discovered token contracts; a changed quote or token identity needs
a new route and a fresh owner approval. Preserve old records for reconciliation.

`SUCCESS` from 1Click still needs destination verification. Receipt checks bind
chain, token, amount, recipient and transaction; Base defaults to twelve
confirmations. `REFUNDED`, incomplete deposits, unknown source broadcasts and
expired quotes remain separate states. Reconcile before sending again.
An ACH funding deposit is capped at that route's quoted output. A destination
transaction can batch transfers to the owner; its surplus remains outside ACH.
API and receipt RPC calls reject redirects, require bounded JSON, and reject
explicitly non-final execution outcomes. Configured receipt RPCs require HTTPS
without URL user information. Token discovery and 1Click route status remain
trusted external inputs alongside the independently configured chain RPC.

The freely available workspace uses NEAR test funds and real dry mainnet USDC
quotes. Mainnet payments require separate funding and explicit owner approval.
Dry quotes have no deposit address and cannot credit ACH. Intents has no
official testnet. A local routing test is not a verified cross-chain transfer.
