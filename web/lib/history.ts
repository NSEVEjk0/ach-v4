import type { Artifact, Invoice, Snapshot } from './v4';
import { money } from './v4';

export interface HistoryEntry {
  key: string;
  kind: 'work' | 'payment' | 'round' | 'account';
  target: 'work' | 'invoice' | 'round' | null;
  reference: string;
  title: string;
  description: string;
  amount: string | null;
  amountLabel: string;
  timestamp: number | null;
  state: 'completed' | 'pending' | 'failed';
  status: string;
  parties: string[];
  tx: string | null;
}

const services: Record<string, string> = { chart: 'Chart generation', audit: 'Data & source checks', references: 'Reference packet' };
const financialState = (status: string): HistoryEntry['state'] => ['SETTLED', 'COMPLETE', 'COMPLETED'].includes(status) ? 'completed' : ['FAILED', 'CANCELLED', 'EXPIRED', 'STALE'].includes(status) ? 'failed' : 'pending';
const identity = (invoice: Invoice) => invoice.private ? invoice.charge_id ?? invoice.spec.id : invoice.spec.id;

export function buildHistory(data: Snapshot, invoices: Invoice[], privateResults: Record<string, Artifact>): HistoryEntry[] {
  const name = (id: string) => data.session.participants.find(participant => participant.account_id === id)?.name ?? id;
  const eventsFor = (id: string) => data.events.filter(event => event.reference === id);
  const eventTime = (id: string, latest = false) => {
    const events = eventsFor(id);
    return (latest ? events.at(-1) : events[0])?.at_ms ?? null;
  };
  const transaction = (id: string) => {
    const event = [...eventsFor(id)].reverse().find(event => event.data.evidence === 'near_final' && typeof event.data.tx_hash === 'string');
    return event ? event.data.tx_hash as string : null;
  };
  const entries: HistoryEntry[] = [];

  for (const job of data.jobs) {
    const result = job.result ?? privateResults[job.id];
    entries.push({ key: 'work:' + job.id, kind: 'work', target: 'work', reference: job.id,
      title: result?.chart.title ?? (job.sealed_result ? 'Private brief' : 'Agent brief'),
      description: result ? `${result.chart.audit ? 'Chart, references and data checks' : 'Chart and references'} · ${job.sealed_result ? 'Private' : 'Public'} brief` : job.state === 'FAILED' ? 'This brief did not complete' : job.sealed_result ? 'Encrypted deliverable is available in its original browser' : 'Your agents are preparing the work',
      amount: null, amountLabel: '', timestamp: eventTime(job.id, job.state === 'COMPLETE'), state: financialState(job.state), status: job.state, parties: [], tx: null });
  }

  for (const invoice of invoices) {
    entries.push({ key: 'payment:' + identity(invoice), kind: 'payment', target: 'invoice', reference: identity(invoice),
      title: services[invoice.spec.service] ?? invoice.spec.service,
      description: `${name(invoice.spec.buyer)} → ${name(invoice.spec.seller)}${invoice.private ? ' · Private' : ''}`,
      amount: invoice.spec.amount, amountLabel: 'Agreed bill', timestamp: invoice.spec.ready_at_ms || eventTime(invoice.spec.id),
      state: financialState(invoice.status), status: invoice.status, parties: [invoice.spec.buyer, invoice.spec.seller], tx: transaction(invoice.spec.id) });
  }

  const knownPrivate = new Set(invoices.filter(invoice => invoice.private).map(identity));
  for (const invoice of data.private_invoices ?? []) {
    if (knownPrivate.has(invoice.nullifier)) continue;
    entries.push({ key: 'payment:' + invoice.nullifier, kind: 'payment', target: 'invoice', reference: invoice.nullifier,
      title: 'Encrypted service payment', description: invoice.parties.map(name).join(' & ') + ' · Private invoice',
      amount: null, amountLabel: 'Encrypted amount', timestamp: invoice.ready_at_ms || null, state: financialState(invoice.status), status: invoice.status, parties: invoice.parties, tx: null });
  }

  for (const round of data.rounds) {
    const settledEvent = [...eventsFor(round.input.id)].reverse().find(event => event.kind === 'round-settled' && event.data.evidence === 'near_final' && typeof event.data.tx_hash === 'string');
    entries.push({ key: 'round:' + round.input.id, kind: 'round', target: 'round', reference: round.input.id,
      title: 'Clearing round', description: `${round.input.positions.length} agents · ${round.input.invoice_ids.length} bills · ${round.input.private ? 'Private' : 'Public'}`,
      amount: round.net_settlement_volume, amountLabel: 'Net funding', timestamp: round.settled_at_ms ?? eventTime(round.input.id),
      state: financialState(round.status), status: round.status, parties: round.input.positions.map(position => position.account_id), tx: settledEvent ? settledEvent.data.tx_hash as string : null });
  }

  for (const event of data.events.filter(event => ['session-ready', 'wallet-setup-waiting'].includes(event.kind))) {
    entries.push({ key: 'account:' + event.sequence, kind: 'account', target: null, reference: event.reference,
      title: event.kind === 'session-ready' ? 'Agent wallets ready' : 'Wallet setup in progress', description: event.kind === 'session-ready' ? 'Your sponsored test session is ready to use' : 'Account creation or funding is awaiting confirmation',
      amount: null, amountLabel: '', timestamp: event.at_ms, state: event.kind === 'session-ready' ? 'completed' : 'pending', status: event.kind === 'session-ready' ? 'COMPLETED' : 'WAITING', parties: [], tx: null });
  }
  return entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || a.key.localeCompare(b.key));
}

export function historyCsv(entries: HistoryEntry[]) {
  const cell = (value: string) => {
    const safe = /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = [['Timestamp', 'Type', 'Description', 'Details', 'Status', 'Amount type', 'Amount (tUSDC)', 'Reference'], ...entries.map(entry => [
    entry.timestamp ? new Date(entry.timestamp).toISOString() : '', entry.kind, entry.title, entry.description, entry.status,
    entry.amountLabel, entry.amount === null ? '' : money(entry.amount, 6), entry.reference,
  ])];
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}
