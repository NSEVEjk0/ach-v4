import { ReceiptText } from 'lucide-react';
import { Arrow } from './Brand';
import { EmptyState, State } from './Interface';
import { invoiceId, money } from '../../lib/v4';
import type { Invoice } from '../../lib/v4';

export const serviceNames: Record<string, string> = {
  chart: 'Chart generation', audit: 'Data & source checks', references: 'Reference packet',
};
export { invoiceId } from '../../lib/v4';

export default function PaymentsTable({ invoices, name, onDetails, selected, onSelect, emptyTitle = 'No payments here yet' }: {
  invoices: Invoice[];
  name: (id: string) => string;
  onDetails: (invoice: Invoice, target: HTMLElement) => void;
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  emptyTitle?: string;
}) {
  if (!invoices.length) return <EmptyState title={emptyTitle} icon={<ReceiptText size={23} />}><p>Accepted service bills will appear as your agents finish their work.</p></EmptyState>;

  return (
    <div className="table-region" role="region" aria-label="Service payments" tabIndex={0}>
      <table className={`ledger-table ${selected ? 'selectable-table' : ''}`}>
        <caption className="sr-only">Agreed service payments and their current clearing status</caption>
        <thead><tr>{selected && <th><span className="sr-only">Include</span></th>}<th>Service</th><th>From</th><th>To</th><th className="numeric">Amount <span className="unit-label">tUSDC</span></th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead>
        <tbody>{invoices.map(invoice => (
          <tr key={invoiceId(invoice)} className={selected && !selected.has(invoiceId(invoice)) ? 'unselected-row' : undefined}>
            {selected && <td className="selection-cell"><input type="checkbox" aria-label={`Include ${serviceNames[invoice.spec.service] ?? invoice.spec.service} payment ${invoice.spec.id}`} checked={selected.has(invoiceId(invoice))} onChange={() => onSelect?.(invoiceId(invoice))} /></td>}
            <td className="payment-service" data-label="Service"><strong>{serviceNames[invoice.spec.service] ?? invoice.spec.service}</strong>{invoice.private && <span className="row-detail">Private invoice</span>}</td>
            <td data-label="From">{name(invoice.spec.buyer)}</td>
            <td data-label="To">{name(invoice.spec.seller)}</td>
            <td className="numeric amount payment-amount" data-label="tUSDC">{money(invoice.spec.amount)}</td>
            <td className="payment-status" data-label="Status"><State status={invoice.status} label={invoice.status === 'ACCEPTED' ? 'Ready to clear' : undefined} /></td>
            <td className="payment-details"><button className="text-button" onClick={event => onDetails(invoice, event.currentTarget)}>Details <Arrow /></button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
