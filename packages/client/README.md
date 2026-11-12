# ACH v4 client

Use Node 22.22.2 or newer and import from `@ach/client/v4`. This package is
distributed as a downloadable tarball; it has not been published to npm.

```js
import {AchV4Client,V4NearTransport} from '@ach/client/v4';
import {v4NetPlan} from '@ach/client/v4';

// The manifest identifies the deployment. Your signer and persistent
// V4Journal stay with your process, outside the coordinator.
const transport=new V4NearTransport(accountId,deployment.rpc_url,signer,journal);
const ach=new AchV4Client(deployment,transport,'agent');
await ach.assertDeployment();
const group=await ach.purchaseGroup(groupId);
// Verify the complete agreed orders and their commitments. Recompute your
// position from the invoice terms agreed before work, independently of a relay.
const expectedNet=v4NetPlan(agreedInvoiceSpecs).positions
  .find(position=>position.account_id===accountId).net;
await ach.authorizePurchaseGroup(group,expectedNet);
// Providers begin only after every participant approves and the group is FUNDED.
const bill=await ach.invoice(invoiceId);
// Check delivery, purchase ID, counterparties, price and artifact hash first.
await ach.acceptInvoice(bill);
const payable=await ach.purchaseGroup(groupId);
if(payable.status==='READY'){
  const round=await ach.round(payable.round_id);
  await ach.settleRound(round);
}
```

The corrected workflow requires a manifest with `workflow_revision: 2` and a
fresh revision-2 vault. The hosted November 10 release uses the earlier workflow;
these local corrections have not been deployed. Use `v4PurchaseGroupId` for the
proposer's group namespace and `v4FundedInvoiceId` for canonical public bill IDs.
Every buyer owns its purchase IDs. No funded group can be split into separate
settlements. Only net debtors reserve money; delivery acceptance transfers those
same reservations into the complete READY round without reserving twice.

Withhold useful output until the entire group is READY or SETTLED. An incomplete
COLLECTING or FUNDED group expires with `expirePurchaseGroup` at its exact agreed
deadline, releasing cash and unused purchase allowance. READY payment commitments
survive their deadline and subsequent trading-policy revocation.

An owner client uses a separate owner signer and the role `owner`. It registers
the account, sets/revokes the trading policy, deposits the allowlisted token, and
withdraws. A function-call trading key must allow only trading/recovery methods;
withdrawal and policy changes require the owner. The hosted sponsor owns the
demonstration identities; independently operated agents retain their keys.
Writes recheck the pinned deployment and workflow revision. A custom transport
must implement `codeHash` when the manifest pins it; verification is required.

Persist every journal operation before broadcast. Retry with the same operation
ID and payload after a lost response. The transport reconciles the recorded
transaction and resubmits the exact bytes only after a definite missing result.
Use `V4MemoryJournal` only for temporary/local examples.
Wrappers over the same signer serialize in one process. Other processes need
distinct signing keys or their own single-writer coordination. `reconcile`
observes an existing transport operation without signing or broadcasting; it
is appropriate for an expired quote's uncertain source transaction.

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
Private orders also authorize their exact funded purchase group before work.
The final verified receipt set and published positions must match that entire
group. Receipt verification alone neither releases output nor grants a debit.

The legacy `ClearingClient` export targets the preserved v2 contract. Use the
explicit `/v4` entrypoint for the new vault. Tests and verified builds are not a
security audit; the testnet vault still has an upgrade key.
