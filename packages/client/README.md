# ACH client SDK

A signer-backed client for agent wallets, funded purchases and clearing on NEAR. Use Node 22.22.2 or newer.

## Install

Download the client and owner-routing packages from the [developer page](https://ach-rosy.vercel.app/developers), then install them in your project:

```sh
npm install ./ach-client-4.0.0.tgz ./ach-intents-4.0.0.tgz
```

The packages are distributed as tarballs and are not published to npm. Import the current vault client from `@ach/client/v4`.

## Approve a purchase group

```js
import { AchV4Client, V4NearTransport, v4NetPlan } from '@ach/client/v4';

const transport = new V4NearTransport(
  accountId, deployment.rpc_url, tradingSigner, persistentJournal
);
const ach = new AchV4Client(deployment, transport, 'agent');
await ach.assertDeployment();

const group = await ach.purchaseGroup(groupId);
const own = v4NetPlan(agreedInvoiceSpecs).positions.find(
  position => position.account_id === accountId
);
if (!own) throw new Error('AGENT_NOT_INCLUDED');
await ach.authorizePurchaseGroup(group, own.net);

// Providers begin after every participant approves and the group is FUNDED.
const bill = await ach.invoice(invoiceId);
// Check the delivery, purchase ID, counterparties, price and artifact hash.
await ach.acceptInvoice(bill);

const payable = await ach.purchaseGroup(groupId);
if (payable.status === 'READY') {
  await ach.settleRound(await ach.round(payable.round_id));
}
```

Check the complete order set against your prior agreements before approving it. Use `v4PurchaseGroupId` for the proposer's group namespace and `v4FundedInvoiceId` for public bill IDs. Buyers own their purchase IDs.

Only net debtors reserve funds. Accepting deliveries moves the existing reservation into the complete ready round. The group cannot be split into separate settlements. Release useful output when the entire group is `READY` or `SETTLED`.

An incomplete `COLLECTING` or `FUNDED` group can expire through `expirePurchaseGroup` at its agreed deadline, releasing reserved cash and unused purchase allowance. A `READY` commitment remains enforceable after its deadline and after trading authority is revoked.

## Register an independent account

Registration requires authorization from the vault's storage sponsor:

```js
// The storage sponsor uses its own signer.
await storageSponsor.sponsorAccount(
  accountId, name, Date.now() + 60 * 60 * 1000, `invite:${accountId}:1`
);

// The agent owner registers the same account name with a separate owner signer.
await owner.register(name);
await owner.setPolicy(policy, `policy:${accountId}:1`);
```

Arrange account gas, token storage registration and settlement-token funding before depositing. Storage sponsorship does not fund the external account. The browser app provisions its hosted test accounts automatically.

An owner client uses the role `owner` and a separate owner signer. Owners register accounts, manage trading policies, deposit and withdraw. Trading keys permit only scoped trading and recovery methods.

## Transactions and amounts

Keep the deployment manifest, signer and persistent journal with the process that operates the account. Writes check the pinned vault and workflow revision. A custom transport must implement `codeHash` when the manifest pins it.

Persist every operation before broadcasting. Retry a lost response with the same operation ID and payload. The transport reconciles the recorded transaction before resubmitting the same bytes. `reconcile` observes an existing operation without signing or broadcasting. Use `V4MemoryJournal` for temporary examples.

Transports sharing a signer serialize within one process. Separate processes need distinct signing keys or their own single-writer coordination.

Amounts are decimal strings of integer token units. The test token uses six decimals. `parseTestUSD` rejects excess decimal places; `formatTestUSD` formats without changing the signed amount. Pending transactions and receivables are not available balances.

## Private invoices

Use `v4PrivateInvoiceCommitment`, `encryptV4Invoice` and `v4PrivateInputCommitment` for private contributions. Both parties sign each contribution, which is padded to 2048 plaintext bytes. A private round supports up to six bills.

Before requesting netting, each participant signs `v4PrivateDisclosureHash` with its current trading key. Receipt processing alone publishes zero movements. Netting discloses the group's approved net positions, which must match its complete funded purchase group.

Invoice contents are encrypted. Participant identities, timing and net movements remain public; a single bill's net movement can reveal its price.

See the [developer guide](https://ach-rosy.vercel.app/developers) and the [owner-routing SDK](../intents/README.md).
