# ACH v4 client

Use Node 22.22.2 or newer and import from `@ach/client/v4`. This package is
distributed as a downloadable tarball; it has not been published to npm.

```js
import {AchV4Client,V4NearTransport} from '@ach/client/v4';

// The manifest identifies the deployment. Your signer and persistent
// V4Journal stay with your process, outside the coordinator.
const transport=new V4NearTransport(accountId,deployment.rpc_url,signer,journal);
const ach=new AchV4Client(deployment,transport,'agent');
await ach.assertDeployment();
const bill=await ach.invoice(invoiceId);
// Check delivery, purchase ID, counterparties, price and artifact hash first.
await ach.acceptInvoice(bill);
const round=await ach.round(roundId);
// Recompute expectedNet from your accepted invoices, independently of a relay.
await ach.authorizeRound(round,expectedNet);
if((await ach.round(roundId)).status==='READY')await ach.settleRound(round);
```

An owner client uses a separate owner signer and the role `owner`. It registers
the account, sets/revokes the trading policy, deposits the allowlisted token, and
withdraws. A function-call trading key must allow only trading/recovery methods;
withdrawal and policy changes require the owner. The hosted sponsor owns the
demonstration identities; independently operated agents retain their keys.

Persist every journal operation before broadcast. Retry with the same operation
ID and payload after a lost response. The transport reconciles the recorded
transaction and resubmits the exact bytes only after a definite missing result.
Use `V4MemoryJournal` only for temporary/local examples.

Money uses decimal strings of integer six-decimal token units. `parseTestUSD`
rejects excess decimals and `formatTestUSD` does not change a signed amount.
Read `result.evidence`, invoice/round state and withdrawal state; submitted
transactions, quotes and receivables are not spendable balance.

Private invoices use `v4PrivateInvoiceCommitment`, `encryptV4Invoice` and
`v4PrivateInputCommitment`. Contributions require both parties' Ed25519
signatures and are padded to 2048 plaintext bytes. A round includes at most six
private bills. Before requesting netting, every participant signs
`v4PrivateDisclosureHash(deployment,inputCommitment,members)` with its current
trading key. Receipt-only verification publishes zero positions; signed netting
publishes the selected group's net movements. Single-bill netting can reveal a
price through those movements. Private balances and unlinkable payouts are not
provided.

The legacy `ClearingClient` export targets the preserved v2 contract. Use the
explicit `/v4` entrypoint for the new vault. Tests and verified builds are not a
security audit; the testnet vault still has an upgrade key.
