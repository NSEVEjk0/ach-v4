import { ArrowUpRight, Check, ChevronDown, Download, LockKeyhole, ReceiptText } from 'lucide-react';
import type { Invoice, Round, Snapshot } from '../../lib/v4';
import { money, preview } from '../../lib/v4';
import PaymentsTable, { invoiceId } from './PaymentsTable';
import { State } from './Interface';

export type RoundAction = 'settle' | 'cancel' | 'expire';
const time = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function RoundDetails({ round, data, invoices, name, scope, disabled, onInvoice, onAction }: {
  round: Round; data: Snapshot; invoices: Invoice[]; name: (id: string) => string; scope: string;
  disabled: boolean; onInvoice: (invoice: Invoice, target: HTMLElement) => void;
  onAction: (action: RoundAction, round: Round) => void;
}) {
  const byId = new Map(invoices.map(invoice => [invoiceId(invoice), invoice]));
  const found = round.input.invoice_ids.map(id => byId.get(id));
  const complete = found.every((invoice, index) => invoice && invoice.hash === round.input.invoice_hashes[index]);
  const known = found.filter((invoice): invoice is Invoice => Boolean(invoice));
  const calculation = complete ? preview(known) : null;
  const matches = calculation && calculation.positions.length === round.input.positions.length && round.input.positions.every(position => calculation.positions.some(computed => computed.account_id === position.account_id && computed.net === position.net));
  const canExplain = Boolean(complete && matches);
  const gross = round.gross_invoice_volume ?? (canExplain ? calculation!.gross : null);
  const offset = gross === null ? null : BigInt(gross) - BigInt(round.net_settlement_volume);
  const settledEvent = [...data.events].reverse().find(event => event.reference === round.input.id && event.kind === 'round-settled' && event.data.evidence === 'near_final' && typeof event.data.tx_hash === 'string');
  const tx = settledEvent?.data.tx_hash as string | undefined;
  const record = { kind: 'ach-v4-round-record', network: data.deployment.network, vault: data.deployment.vault, token: data.deployment.token, round, transaction_hash: tx ?? null };
  const isClosed = ['CANCELLED', 'EXPIRED', 'STALE', 'FAILED'].includes(round.status);

  return (
    <div className="round-details">
      <div className="round-explanation-intro"><ReceiptText size={19} /><p>{round.status === 'SETTLED' ? 'This is the invoice set and exact result the agents approved and settled.' : 'This proposal records the exact bills and result each included agent is asked to approve.'}</p></div>
      <div className="round-totals">
        <div><span>Agreed bills</span><strong>{gross === null ? 'Encrypted' : money(gross)}{gross !== null && <small> tUSDC</small>}</strong>{round.input.private && gross !== null && <small className="local-detail">Decrypted in this browser</small>}</div>
        <div><span>Payments offset</span><strong>{offset === null ? 'Encrypted' : money(offset.toString())}{offset !== null && <small> tUSDC</small>}</strong></div>
        <div><span>Net funding</span><strong>{money(round.net_settlement_volume)}<small> tUSDC</small></strong></div>
      </div>

      <section className="round-explanation-step">
        <h4><span>1</span> The bills included</h4>
        {known.length ? <PaymentsTable invoices={known} name={name} onDetails={onInvoice} /> : <div className="private-record-note"><LockKeyhole size={19} /><p>{round.input.invoice_ids.length} encrypted invoices are bound to this round. The browser that created the private brief can open their contents.</p></div>}
        {known.length > 0 && known.length < round.input.invoice_ids.length && <p className="form-hint">{round.input.invoice_ids.length - known.length} additional encrypted invoice records are included. Their contents are unavailable in this browser.</p>}
      </section>

      <section className="round-explanation-step">
        <h4><span>2</span> How the payments offset</h4>
        <p className="round-step-description">{canExplain ? 'For each agent, subtract the money it owes from the money it is due. A negative result is a payment; a positive result is a receipt.' : 'These are the exact net positions approved for this round. The complete bound invoice set is needed to show the full calculation.'}</p>
        <div className="table-region" role="region" aria-label="Round net calculation" tabIndex={0}>
          <table className="net-calculation-table"><caption className="sr-only">Each participant’s approved final payment or receipt</caption><thead><tr><th>Agent</th>{canExplain && <><th className="numeric">Is due</th><th className="numeric">Owes</th></>}<th className="numeric">Final movement / tUSDC</th></tr></thead>
            <tbody>{round.input.positions.map(position => {
              const owed = canExplain ? known.filter(invoice => invoice.spec.buyer === position.account_id).reduce((total, invoice) => total + BigInt(invoice.spec.amount), 0n) : null;
              const due = canExplain ? known.filter(invoice => invoice.spec.seller === position.account_id).reduce((total, invoice) => total + BigInt(invoice.spec.amount), 0n) : null;
              const net = BigInt(position.net);
              return <tr key={position.account_id}><td>{name(position.account_id)}</td>{canExplain && <><td className="numeric amount">{money(due!.toString())}</td><td className="numeric amount">{money(owed!.toString())}</td></>}<td className="numeric amount"><span className={`movement ${net > 0n ? 'incoming' : ''}`}>{net === 0n ? 'No transfer' : <>{net < 0n ? 'Pays' : 'Receives'} <strong>{money((net < 0n ? -net : net).toString())}</strong></>}</span></td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="round-explanation-step">
        <h4><span>3</span> Approvals and funding</h4>
        <div className="approval-list">{round.input.positions.map(position => {
          const approval = round.approvals.find(approval => approval.account_id === position.account_id);
          return <div className="approval-row" key={position.account_id}><div><strong>{name(position.account_id)}</strong><span>{approval ? approval.required === '0' ? 'No cash required from this agent' : `${money(approval.required)} tUSDC ${round.status === 'SETTLED' ? 'funded the settlement' : isClosed ? 'was approved' : 'reserved for this round'}` : 'Approval is still needed'}</span></div><State status={approval ? 'ACCEPTED' : 'WAITING'} label={approval ? 'Approved' : 'Waiting'} /></div>;
        })}</div>
        <p className="round-step-description">{round.status === 'SETTLED' ? 'Every included agent approved the same round. Reserved funds were used when all its bills cleared together.' : round.status === 'READY' ? 'Every included agent has approved. The required funding is reserved, and this round can now settle.' : isClosed ? 'This round did not proceed to settlement. Its recorded terms remain available for inspection.' : 'The round can proceed once every included agent approves and the net debtors have reserved the required funds.'}</p>
      </section>

      <section className="round-explanation-step receipt-step">
        <h4><span>4</span> Settlement record</h4>
        <div className="receipt-summary"><State status={round.status} /><span>{round.settled_at_ms ? `Settled ${time(round.settled_at_ms)}` : `Approval deadline ${time(round.input.deadline_ms)}`}</span></div>
        {round.reason && <p className="form-hint">Recorded reason: {round.reason.toLowerCase().replaceAll('_', ' ')}</p>}
        <div className="receipt-actions">{tx ? <a className="button secondary" href={`https://testnet.nearblocks.io/txns/${tx}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={15} /></a> : <a className="text-link" href={`https://testnet.nearblocks.io/address/${data.deployment.vault}`} target="_blank" rel="noreferrer">View the vault on NEAR <ArrowUpRight size={15} /></a>}<a className="text-link" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(record, null, 2))}`} download="ach-clearing-round.json">Download round record <Download size={15} /></a></div>
        {!tx && round.status === 'SETTLED' && <p className="form-hint">The confirmed round reports settlement. Its transaction link was not included in the available session events.</p>}
        <details className="technical-details"><summary>Receipt identifiers <ChevronDown size={15} /></summary><dl className="detail-list"><div><dt>Round</dt><dd className="mono">{round.input.id}</dd></div><div><dt>Approved hash</dt><dd className="mono">{round.hash}</dd></div><div><dt>Network / vault</dt><dd className="mono">{data.deployment.network} / {data.deployment.vault}</dd></div>{round.input.worker_hash && <div><dt>Verified worker</dt><dd className="mono">{round.input.worker_hash}</dd></div>}<div><dt>Bound invoice set</dt><dd>{round.input.invoice_ids.map((id, index) => <span className="receipt-invoice-id mono" key={id}>{id}<small>{round.input.invoice_hashes[index]}</small></span>)}</dd></div></dl></details>
      </section>

      {round.status === 'READY' && <button className="button primary" disabled={disabled} onClick={() => onAction('settle', round)}>Settle funded round <Check size={16} /></button>}
      {round.status === 'COLLECTING' && round.approvals.some(approval => approval.account_id === scope) && <button className="button secondary" disabled={disabled} onClick={() => onAction('cancel', round)}>Cancel {name(scope)}’s approval</button>}
      {round.status === 'COLLECTING' && round.input.deadline_ms <= Date.now() && <button className="button secondary" disabled={disabled} onClick={() => onAction('expire', round)}>Release expired proposal</button>}
    </div>
  );
}
