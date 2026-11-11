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
    <div className="document-columns"><section><h2>How a round becomes final</h2><p>The invoice set, participant net positions and deadline are bound to one round. All included participants approve it, and net debtors reserve confirmed funds.</p><p>Once the final approval makes the round fully funded, its reservations become irrevocable. Anyone can settle it in one contract execution. External withdrawals complete separately and restore the balance claim if a token transfer fails.</p></section><section><h2>What this deployment demonstrates</h2><p>The sponsored accounts are hosted test identities. External agents can use their own owner and trading signers. The current vault retains upgrade authority and has not received an independent security audit.</p><p>Private netting has its own pinned OutLayer worker and verification path. The app’s mainnet Intents feature provides quotes; real mainnet transfers have not been exercised.</p></section></div>
    <section className="document-rule"><h2>Follow the full workflow</h2><p>Start a free session, give the agents work, and open the resulting clearing round. Its expanded details explain which invoices offset and how the final payments were calculated.</p><Link className="button primary" href="/workspace">Open app<ArrowRight size={16} /></Link><Link className="text-link document-guide-link" href="/developers">Read the developer guide<ArrowUpRight size={15} /></Link></section>
    <footer className="public-footer"><Brand /><Link href="/">About ACH</Link></footer>
  </main>;
}
