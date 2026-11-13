import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import PublicNav from '../../components/v4/PublicNav';
import { Brand } from '../../components/v4/Brand';
import { coordinatorUrl } from '../../lib/gateway';

export const dynamic = 'force-dynamic';

export default async function Proof() {
  let config: { network: string; vault: string; token: string; status: string } | null = null;
  const token = process.env.ACH_V4_SERVICE_TOKEN;
  if (token) {
    try {
      const base = await coordinatorUrl();
      const response = await fetch(new URL('/config', base), { headers: { 'x-ach-service-token': token }, cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (response.ok) config = await response.json();
    } catch { /* Keep live availability explicit when the service cannot be reached. */ }
  }
  return <main className="document-page"><PublicNav />
    <Link className="back-link" href="/"><ArrowLeft size={15} />Back to ACH</Link>
    <span className="section-kicker">Live deployment · ACH v4</span><h1>See where the<br />payments settle.</h1>
    <p className="document-lead">Inspect the current contract on NEAR testnet. Your session’s clearing records show the exact bills, approvals and resulting payments.</p>
    {config ? <section className="proof-table"><dl>
      <div><dt>Network</dt><dd>{config.network === 'testnet' ? 'NEAR testnet' : config.network}</dd></div>
      <div><dt>Clearing vault</dt><dd><a href={`https://testnet.nearblocks.io/address/${config.vault}`} target="_blank" rel="noreferrer">{config.vault}<ArrowUpRight size={15} /></a></dd></div>
      <div><dt>Settlement token</dt><dd>{config.token}<br /><span className="form-hint">Test USDC · six decimals · no monetary value</span></dd></div>
      <div><dt>Version</dt><dd>ACH v4</dd></div>
    </dl><p>Open History or Clearing in your session to inspect a round. Transaction links appear where a receipt is available.</p><Link className="text-link" href="/workspace?view=history">Open session history<ArrowRight size={15} /></Link></section> : <section className="work-surface empty-state"><h2>Deployment details are temporarily unavailable.</h2><p>The live service could not be reached. Reload this page to try again.</p></section>}
    <div className="document-columns"><section><h2>How a round becomes final</h2><p>The invoice set, participant net positions and deadline are bound to one round. All included participants approve it, and net debtors reserve confirmed funds.</p><p>Providers complete the agreed work against the funded group. Once every delivery is accepted, anyone can settle the ready round in one contract execution. External withdrawals complete separately and restore the balance claim if a token transfer fails.</p></section><section><h2>Your wallets and invoices</h2><p>Owners control funding, withdrawals and spending permissions. Agents approve their own payment commitments through separate trading signers. Sponsored demo identities are operator-managed test accounts.</p><p>Private invoice contributions are encrypted for the pinned OutLayer worker. Participants authorize the resulting net positions before settlement. The Intents picker offers funding and payout previews from its live chain and token catalogue. All browser quotes are dry; no cross-chain transfer is sent and ACH mainnet execution is deferred.</p></section></div>
    <section className="document-rule"><h2>Test a larger clearing group</h2><p>Open Clearing → <strong>Test netting with more agents</strong>, choose 3–12 signers and prepare fresh judge wallets if prompted. Run public or encrypted synthetic bills, then inspect the settled round and its final transaction receipt.</p><p>Public rounds allow up to 48 bills; private rounds allow six, both with up to 12 participants. The 12-agent public cycle clears 0.980 tUSDC of bills with 0.020 tUSDC in net payments. The 12-agent private test uses six independent pairs with no offsetting payments, settling 0.500 tUSDC.</p><p>Your own session receipts provide the live transaction evidence. Local Wasm tests and dry quotes establish different behavior and do not prove an executed cross-chain payment.</p><Link className="button primary" href="/workspace?view=clearing">Open netting tests<ArrowRight size={16} /></Link><Link className="text-link document-guide-link" href="/developers">Read the developer guide<ArrowUpRight size={15} /></Link></section>
    <footer className="public-footer"><Brand /><Link href="/">About ACH</Link></footer>
  </main>;
}
