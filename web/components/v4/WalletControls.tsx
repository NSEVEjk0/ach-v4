import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';
import type { Balance } from '../../lib/v4';
import { money } from '../../lib/v4';
import { PanelHeading, State } from './Interface';

export default function WalletControls({ wallet, scope, outside, recovery, withdrawal, deposit, pending, stale, onWithdrawal, onDeposit, onWithdraw, onRedeposit, onRounds }: {
  wallet: Balance | undefined; scope: string; outside?: { amount: string }; recovery?: { sequence: number; status: string };
  withdrawal: string; deposit: string; pending: string; stale: boolean;
  onWithdrawal: (value: string) => void; onDeposit: (value: string) => void;
  onWithdraw: (all?: boolean) => void; onRedeposit: () => void; onRounds: () => void;
}) {
  const disabled = Boolean(pending) || !wallet || wallet.available === '0' || stale;
  return (
    <section className="work-surface wallet-work">
      <PanelHeading title="Move your available funds" description="Withdraw test tokens to the selected agent’s account and deposit them back when needed."><State status={wallet?.pending_withdrawals && wallet.pending_withdrawals !== '0' ? 'PENDING' : 'AVAILABLE'} /></PanelHeading>
      <div className="wallet-actions">
        <div className="wallet-transfer-form"><span className="transfer-icon"><ArrowUpRight size={21} /></span><h3>Withdraw test funds</h3><p>The tokens go to this agent’s NEAR account.</p>
          <label>Amount / tUSDC<input inputMode="decimal" value={withdrawal} onChange={event => onWithdrawal(event.target.value)} placeholder={wallet ? money(wallet.available) : '0.00'} /></label>
          <p className="form-hint">Leaving the amount blank withdraws the available balance shown above.</p>
          <p className="destination-label">Receiving agent account<span className="mono">{scope}</span></p>
          <button className="button primary" disabled={disabled} onClick={() => onWithdraw()}>{pending === 'withdraw' ? 'Confirming withdrawal…' : 'Withdraw test funds'}<ArrowUpRight size={16} /></button>
          {recovery && <button className="text-button" disabled={disabled || recovery.status === 'PENDING'} onClick={() => onWithdraw(true)}>Withdraw all available <ArrowUpRight size={14} /></button>}
          {outside && outside.amount !== '0' && <div className="redeposit-form"><span className="transfer-icon"><ArrowDownLeft size={21} /></span><h3>Return tokens to the wallet</h3><p>{money(outside.amount)} tUSDC is in the agent’s account.</p><label>Amount / tUSDC<input inputMode="decimal" value={deposit} onChange={event => onDeposit(event.target.value)} placeholder={money(outside.amount)} /></label><p className="form-hint">Leaving this blank deposits the account’s test-token balance.</p><button className="button secondary" disabled={Boolean(pending) || stale} onClick={onRedeposit}>{pending === 'deposit' ? 'Confirming deposit…' : 'Deposit from agent account'}<ArrowDownLeft size={16} /></button></div>}
        </div>
        <aside className="wallet-note"><Wallet size={24} /><h3>What is available to move?</h3><p>Available money can be withdrawn. Funds reserved for an approved round stay with that commitment.</p><dl className="compact-definitions"><div><dt>Pending withdrawals</dt><dd>{wallet ? money(wallet.pending_withdrawals) : '—'} tUSDC</dd></div><div><dt>Outside this wallet</dt><dd>{outside ? money(outside.amount) : '—'} tUSDC</dd></div></dl><p>A fully funded round settles all its bills together. An incomplete approval can be cancelled before the round is funded.</p><button className="text-button" onClick={onRounds}>Review clearing rounds <ArrowUpRight size={14} /></button><p className="form-hint">Withdrawal confirmation is separate from internal clearing. If a token transfer fails, the vault restores the available claim.</p></aside>
      </div>
    </section>
  );
}
