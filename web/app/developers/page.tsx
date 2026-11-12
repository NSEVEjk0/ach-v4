import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Download } from 'lucide-react';
import PublicNav from '../../components/v4/PublicNav';
import { Brand } from '../../components/v4/Brand';

const snippet = [
  'import { AchV4Client, v4NetPlan } from "@ach/client/v4";', '',
  '// Connect a transport backed by your agent’s trading signer.',
  'const ach = new AchV4Client(deployment, transport);',
  'await ach.assertDeployment();', '',
  'const group = await ach.purchaseGroup(groupId);',
  '// Validate every order against your prior agreements.',
  'const own = v4NetPlan(agreedInvoiceSpecs).positions.find(',
  '  p => p.account_id === transport.account_id',
  ');',
  'await ach.authorizePurchaseGroup(group, own.net);', '',
  '// Work begins once all approvals make the group FUNDED.',
  'const bill = await ach.invoice(invoiceId);',
  '// Validate the delivery before accepting its exact hash.',
  'await ach.acceptInvoice(bill);', '',
  'const payable = await ach.purchaseGroup(groupId);',
  'if (payable.status === "READY") {',
  '  const round = await ach.round(payable.round_id);',
  '  await ach.settleRound(round);',
  '}',
  'console.log(await ach.balance());',
].join('\n');

export default function Developers() {
  return <main className="document-page"><PublicNav />
    <Link className="back-link" href="/"><ArrowLeft size={15} />Back to ACH</Link>
    <span className="section-kicker">Developer guide · ACH v4</span>
    <h1>Connect your agents<br />to ACH.</h1>
    <p className="document-lead">Your agents agree their purchase group and approve its final amounts before work begins. The owner controls deposits, withdrawals and spending permissions.</p>
    <div className="document-columns"><section><h2>From a purchase to payment</h2>
      <ol><li><strong>Set up the wallet.</strong> Obtain registration authorization from the vault’s storage sponsor, then register with your owner signer, deposit the settlement token and set a scoped trading policy.</li><li><strong>Agree the group.</strong> Bind every purchase ID, provider, price, delivery commitment and deadline. Calculate each participant’s exact net payment.</li><li><strong>Approve and fund.</strong> Each included agent authorizes the immutable purchase group hash and its own net amount. Only net debtors reserve cash.</li><li><strong>Complete the deliveries.</strong> Providers execute against the FUNDED group. Buyers and sellers validate and accept each exact final invoice.</li><li><strong>Release useful output.</strong> The whole group must be READY or SETTLED. An incomplete group expires and returns reservations and unused allowance.</li><li><strong>Settle and use the funds.</strong> Anyone can settle the complete READY round. The owner can withdraw available funds.</li></ol>
      <p>Purchase allowance is charged during authorization. Accepted deliveries use the group’s existing reservation; its bills cannot clear separately. Receipts become spendable after settlement. Providers still define objective delivery rules and bear execution costs if another delivery fails.</p>
    </section><section><h2>Approve a funded purchase group</h2><pre><code>{snippet}</code></pre><p>The example uses independently agreed invoice terms to calculate the agent’s position. The current sponsored deployment uses workflow revision 2; verify its manifest and pinned vault before connecting. Trading keys cannot withdraw tokens or change the owner’s policy.</p></section></div>
    <section className="document-rule"><h2>Download the SDK</h2><p>Install both downloaded packages together. They are available here as tarballs; they have not been published to npm.</p>
      <div className="sdk-downloads"><a className="button secondary" href="/sdk/ach-client-4.0.0.tgz" download>ACH client<Download size={16} /></a><a className="button secondary" href="/sdk/ach-intents-4.0.0.tgz" download>Owner routing<Download size={16} /></a></div>
      <pre><code>npm install ./ach-client-4.0.0.tgz ./ach-intents-4.0.0.tgz</code></pre>
      <p>Use Node 22.22.2 or newer. Keep a persistent transaction journal so a lost response can be reconciled before resubmission.</p>
      <p>Independent agents keep their owner and trading keys. The storage sponsor authorizes the account ID and display name with <code>sponsorAccount</code>; the agent registers that same name with its own owner signer. Arrange external account gas, token storage and funding separately. The free browser session sponsors its hosted accounts automatically.</p>
    </section>
    <section className="document-rule"><h2>Spending permissions</h2><p>The owner sets permitted services and counterparties, the largest invoice, total purchase allowance, maximum net commitment and expiry. Gross purchase limits still apply when payments offset. Owner registration, policy changes, deposits and withdrawals use a separate owner signer.</p>
      <h2>Private invoices</h2><p>Service providers receive the work they need to perform. Private orders authorize their exact funded purchase group before execution. Invoice contributions are encrypted for the pinned OutLayer worker. Receipt verification publishes zero movements; netting requires disclosure consent and verifies the complete group against its already authorized positions.</p><p>Participant identities, timing and net amounts remain public. The original browser opens encrypted results after the payment commitment is READY or SETTLED. OutLayer verifies the netting calculation; delivery validation remains a separate responsibility.</p>
      <h2 id="funding">Funding and payouts across chains</h2><p>The app previews real mainnet USDC quotes between Base and NEAR. Execution uses the owner routing SDK, a source signer and a separately funded mainnet vault.</p><p>Import <code>OwnerIntentsRouter</code>, <code>NearTokenRouteSender</code> and <code>destinationReceiptVerifier</code> from <code>@ach/intents/owner</code>. Prepare a quote, review its exact approval hash, then execute through your source signer. The package includes the interfaces and example.</p><p>Funding reaches the owner before an authenticated ACH deposit. Payouts withdraw to the owner before routing. Base transfers require an owner-operated <code>SourceSender</code>. Completion checks the destination chain, token, recipient and amount against a receipt.</p><p>Each vault clears one settlement token. External routing and internal clearing have separate receipts and recovery states.</p>
      <Link className="text-link" href="/proof">Inspect the live deployment<ArrowRight size={16} /></Link>
    </section>
    <footer className="public-footer"><Brand /><Link href="/workspace">Open app<ArrowUpRight size={15} /></Link><Link href="/">About ACH</Link></footer>
  </main>;
}
