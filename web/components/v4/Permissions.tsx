import Link from 'next/link';
import { ArrowUpRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Balance, Snapshot } from '../../lib/v4';
import { money } from '../../lib/v4';
import { PanelHeading } from './Interface';

export default function Permissions({ wallet, data, pending, stale, onRevoke }: { wallet: Balance | undefined; data: Snapshot; pending: string; stale: boolean; onRevoke: () => void }) {
  return (
    <section className="work-surface permissions-surface">
      <PanelHeading title="Trading permissions" description="The owner sets the limits. This agent can purchase and approve within them."><span className={`tag ${wallet?.policy?.revoked ? 'warning-tag' : 'positive-tag'}`}>{wallet?.policy?.revoked ? 'Trading revoked' : 'Trading enabled'}</span></PanelHeading>
      <div className="settings-grid">
        <div><dl className="policy-list"><div><dt>Maximum bill</dt><dd>{wallet?.policy ? money(wallet.policy.max_invoice) : '—'} tUSDC</dd></div><div><dt>Total purchase allowance</dt><dd>{wallet?.policy ? money(wallet.policy.gross_budget) : '—'} tUSDC</dd></div><div><dt>Allowance used</dt><dd>{wallet ? money(wallet.gross_purchase_budget_used) : '—'} tUSDC</dd></div><div><dt>Maximum net payment</dt><dd>{wallet?.policy ? money(wallet.policy.max_net_commitment) : '—'} tUSDC</dd></div><div><dt>Permission expires</dt><dd>{wallet?.policy ? new Date(wallet.policy.expires_at_ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></div></dl>
          <p className="form-hint">Purchase allowance includes pending and settled purchases. Netting reduces funding needs while each gross purchase still counts toward its allowance.</p>
          <div className="revoke-section"><h3>Revoke this agent’s authority</h3><p>Stops new purchases and approvals. Already funded rounds remain enforceable, and available funds remain withdrawable.</p><button className="button danger" disabled={Boolean(pending) || wallet?.policy?.revoked || stale} onClick={onRevoke}>{pending === 'revoke' ? 'Revoking authority…' : 'Revoke this agent'}</button></div>
        </div>
        <div className="integration-settings"><article><LockKeyhole size={20} /><h3>Private processing</h3><span className="tag">{data.privacy.verified ? 'Live verification' : 'Verification in progress'}</span><p>Choose private invoices when creating a brief. OutLayer verifies the encrypted contributions; the approved net positions remain public.</p></article><article><ArrowUpRight size={20} /><h3>Funding between chains</h3><p>The wallet can preview USDC routes between Base and NEAR. Owner-controlled transfers have separate receipts from internal clearing.</p><Link className="text-link" href="/developers#funding">Owner routing guide <ArrowUpRight size={14} /></Link></article><article><ShieldCheck size={20} /><h3>Connect your own agents</h3><p>The SDK supports separate owner and trading signers. The free session supplies hosted test identities to let you try the complete workflow.</p><Link className="text-link" href="/developers">Developer guide <ArrowUpRight size={14} /></Link></article></div>
      </div>
    </section>
  );
}
