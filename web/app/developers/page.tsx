import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Download } from 'lucide-react';
import PublicNav from '../../components/v4/PublicNav';
import { Brand } from '../../components/v4/Brand';

const snippet = [
  'import { AchV4Client } from "@ach/client/v4";', '',
  '// Connect a transport backed by your agent’s trading signer.',
  'const ach = new AchV4Client(deployment, transport);',
  'await ach.assertDeployment();', '',
  'const bill = await ach.invoice(invoiceId);',
  '// Check the agreed order, amount and delivered artifact.',
  'await ach.acceptInvoice(bill);', '',
  'const round = await ach.round(roundId);',
  'const own = round.input.positions.find(',
  '  p => p.account_id === transport.account_id',
  ');',
  '// Recalculate your net from the exact included invoices.',
  'await ach.authorizeRound(round, own.net);', '',
  'if ((await ach.round(roundId)).status === "READY") {',
  '  await ach.settleRound(round);',
  '}',
  'console.log(await ach.balance());',
].join('\n');

export default function Developers() {
  return <main className="document-page"><PublicNav />
    <Link className="back-link" href="/"><ArrowLeft size={15} />Back to ACH</Link>
    <span className="section-kicker">Developer guide · ACH v4</span>
    <h1>Connect your agents<br />to ACH.</h1>
    <p className="document-lead">Your agents agree service bills, review clearing proposals and approve their final amounts with their own trading keys. The owner controls deposits, withdrawals and spending permissions.</p>
    <div className="document-columns"><section><h2>From a purchase to payment</h2>
      <ol><li><strong>Set up the wallet.</strong> Register the owner account, deposit the settlement token and set a scoped trading policy.</li><li><strong>Agree the work.</strong> Define a purchase ID, price, service and delivery rule with the provider.</li><li><strong>Review delivery.</strong> Check the received work and accept the exact final invoice.</li><li><strong>Choose a clearing group.</strong> Include accepted bills and calculate each participant’s net payment.</li><li><strong>Approve the result.</strong> Every included agent authorizes the immutable round hash and its own exact net amount.</li><li><strong>Settle and use the funds.</strong> Anyone can settle a fully funded round. The owner can withdraw available funds.</li></ol>
      <p>Invoice acceptance uses purchase allowance. Net debtor funds are reserved when the round is approved. A receivable becomes spendable after settlement; providers need their own policy for when to release work.</p>
    </section><section><h2>Review and approve a round</h2><pre><code>{snippet}</code></pre><p>The example assumes your agent has already validated its order and the round’s invoices. Trading keys cannot withdraw tokens or change the owner’s policy.</p></section></div>
    <section className="document-rule"><h2>Download the SDK</h2><p>Install both downloaded packages together. They are available here as tarballs; they have not been published to npm.</p>
      <div className="sdk-downloads"><a className="button secondary" href="/sdk/ach-client-4.0.0.tgz" download>ACH client<Download size={16} /></a><a className="button secondary" href="/sdk/ach-intents-4.0.0.tgz" download>Owner routing<Download size={16} /></a></div>
      <pre><code>npm install ./ach-client-4.0.0.tgz ./ach-intents-4.0.0.tgz</code></pre>
      <p>Use Node 22.22.2 or newer. Keep a persistent transaction journal so a lost response can be reconciled before resubmission.</p>
    </section>
    <section className="document-rule"><h2>Spending permissions</h2><p>The owner sets permitted services and counterparties, the largest invoice, total purchase allowance, maximum net commitment and expiry. Gross purchase limits still apply when payments offset. Owner registration, policy changes, deposits and withdrawals use a separate owner signer.</p>
      <h2>Private invoices</h2><p>Service providers receive the work they need to perform. Private invoice contributions are encrypted for the pinned OutLayer worker. Receipt verification publishes zero movements; private netting requires the included parties to consent to the exact set’s net disclosure before computation, then approve settlement.</p><p>Participant identities, timing and net amounts remain public. The original browser opens the encrypted demo results. OutLayer verifies the netting calculation; delivery validation is a separate responsibility.</p>
      <h2 id="funding">Funding and payouts across chains</h2><p>The app previews real mainnet USDC quotes between Base and NEAR. Execution uses the owner routing SDK, a source signer and a separately funded mainnet vault.</p><p>Import <code>OwnerIntentsRouter</code>, <code>NearTokenRouteSender</code> and <code>destinationReceiptVerifier</code> from <code>@ach/intents/owner</code>. Prepare a quote, review its exact approval hash, then execute through your source signer. The package includes the interfaces and example.</p><p>Funding reaches the owner before an authenticated ACH deposit. Payouts withdraw to the owner before routing. Base transfers require an owner-operated <code>SourceSender</code>. Completion checks the destination chain, token, recipient and amount against a receipt.</p><p>Mainnet transfers have not been exercised in this demo. Each vault clears one settlement token. External routing and internal clearing have separate receipts and recovery states.</p>
      <Link className="text-link" href="/proof">Inspect the live deployment<ArrowRight size={16} /></Link>
    </section>
    <footer className="public-footer"><Brand /><Link href="/workspace">Open app<ArrowUpRight size={15} /></Link><Link href="/">About ACH</Link></footer>
  </main>;
}
