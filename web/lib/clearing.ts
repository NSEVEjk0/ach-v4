import { invoiceId, preview } from './v4';
import type { Balance, Invoice, Position, Round } from './v4';

const sameIds = (a: string[], b: string[]) => a.length === new Set(a).size && b.length === new Set(b).size && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const samePositions = (a: Position[], b: Position[]) => {
  const fields = (positions: Position[]) => positions.map(position => [position.account_id, position.net]).sort(([x],[y]) => x < y ? -1 : x > y ? 1 : 0);
  return JSON.stringify(fields(a)) === JSON.stringify(fields(b));
};

// Reservations belong to an exact READY round. Aggregate wallet reservations
// and approvals from other rounds cannot fund a new invoice selection.
export function clearingSelection({ ledger, rounds = [], balances = [], selected, excludedBills, privacy, requestedGroup = '' }: {
  ledger: Invoice[]; rounds?: Round[]; balances?: Balance[]; selected: string[];
  excludedBills: string[]; privacy: 'public' | 'private'; requestedGroup?: string;
}) {
  const privateMode = privacy === 'private';
  const payable = ledger.filter(invoice => ['ACCEPTED', 'READY'].includes(invoice.status) && Boolean(invoice.private) === privateMode);
  const approvedGroups = [...new Set(payable.filter(invoice => invoice.status === 'READY' && invoice.round_id).map(invoice => invoice.round_id!))];
  const activeGroup = approvedGroups.includes(requestedGroup) ? requestedGroup : approvedGroups[0] ?? '';
  const approvedRound = rounds.find(round => round.input.id === activeGroup && round.status === 'READY' && round.input.private === privateMode);
  const accepted = activeGroup ? payable.filter(invoice => invoice.round_id === activeGroup) : payable;
  const candidates = accepted.filter(invoice => selected.includes(invoice.spec.buyer) && selected.includes(invoice.spec.seller));
  const included = candidates.filter(invoice => !excludedBills.includes(invoiceId(invoice)));
  const includedIds = new Set(included.map(invoiceId));
  const plan = preview(included), fullPlan = preview(accepted);
  const exactRound = Boolean(approvedRound && sameIds(accepted.map(invoiceId), approvedRound.input.invoice_ids) && samePositions(fullPlan.positions, approvedRound.input.positions) && approvedRound.input.positions.every(position => {
    const approvals = approvedRound.approvals.filter(approval => approval.account_id === position.account_id);
    const required = BigInt(position.net) < 0n ? (-BigInt(position.net)).toString() : '0';
    return approvals.length === 1 && approvals[0].required === required;
  }));
  const metadataIncomplete = Boolean(activeGroup && !exactRound) || accepted.some(invoice => invoice.status === 'READY' && !invoice.round_id);
  const selectionIncomplete = metadataIncomplete || Boolean(approvedRound && !sameIds(included.map(invoiceId), approvedRound.input.invoice_ids)) || (!approvedRound && included.some(invoice => invoice.funding_group_id));
  const underfunded = plan.positions.filter(position => {
    const reserved = exactRound ? BigInt(approvedRound!.approvals.find(approval => approval.account_id === position.account_id)?.required ?? '0') : 0n;
    const available = BigInt(balances.find(balance => balance.account_id === position.account_id)?.available ?? '0');
    return BigInt(position.net) < 0n && -BigInt(position.net) > available + reserved;
  });
  const canClear = included.length > 0 && !selectionIncomplete && underfunded.length === 0 && (!privateMode || included.length <= 6);
  return { payable, approvedGroups, activeGroup, approvedRound, accepted, candidates, included, includedIds, plan, fullPlan, underfunded, metadataIncomplete, selectionIncomplete, canClear };
}
