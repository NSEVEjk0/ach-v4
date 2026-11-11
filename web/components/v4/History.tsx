'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Download, FileText, History as HistoryIcon, Search, Wallet, ArrowLeftRight } from 'lucide-react';
import { money } from '../../lib/v4';
import type { Snapshot } from '../../lib/v4';
import { historyCsv } from '../../lib/history';
import type { HistoryEntry } from '../../lib/history';
import { EmptyState, PanelHeading, State } from './Interface';
import { workspaceHref } from './useWorkspaceNavigation';
import type { WorkspaceRoute } from './useWorkspaceNavigation';

const icons = { work: FileText, payment: ArrowUpRight, round: ArrowLeftRight, account: Wallet };
const pageSize = 12;

export function historyTarget(entry: HistoryEntry, route: WorkspaceRoute): WorkspaceRoute | null {
  if (entry.target === 'round') return { view: 'clearing', agent: route.agent, round: entry.reference };
  if (entry.target) return { ...route, item: entry.target, id: entry.reference };
  return null;
}

export function HistoryRows({ entries, route, onOpen }: { entries: HistoryEntry[]; route: WorkspaceRoute; onOpen: (entry: HistoryEntry, target: HTMLElement) => void }) {
  return <div className="history-list">{entries.map(entry => {
    const Icon = icons[entry.kind];
    const target = historyTarget(entry, route);
    const content = <><span className={`history-icon history-${entry.kind}`}><Icon size={18} /></span><span className="history-description"><strong>{entry.title}</strong><span>{entry.description}</span><small>{entry.timestamp ? new Date(entry.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Recorded this session · time unavailable'}</small></span><span className="history-result">{entry.amount !== null && <strong className="amount">{money(entry.amount)} <small>tUSDC</small></strong>}{entry.amountLabel && <small>{entry.amountLabel}</small>}<State status={entry.status} label={entry.status === 'ACCEPTED' ? 'Ready to clear' : undefined} /></span>{target && <ArrowUpRight className="history-open-icon" size={17} />}</>;
    return target ? <a className="history-row" href={workspaceHref(target)} key={entry.key} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(entry, event.currentTarget); }}>{content}</a> : <div className="history-row" key={entry.key}>{content}</div>;
  })}</div>;
}

export default function History({ entries, data, route, onFilter, onOpen }: {
  entries: HistoryEntry[]; data: Snapshot; route: WorkspaceRoute;
  onFilter: (route: WorkspaceRoute) => void; onOpen: (entry: HistoryEntry, target: HTMLElement) => void;
}) {
  const [page, setPage] = useState(1);
  const category = ['work', 'payments', 'clearing', 'account'].includes(route.category ?? '') ? route.category! : 'all';
  const status = ['completed', 'pending', 'failed'].includes(route.status ?? '') ? route.status! : 'all';
  const query = route.q ?? '';
  const party = route.party ?? 'all';
  const filtered = useMemo(() => entries.filter(entry =>
    (category === 'all' || ({ work: 'work', payments: 'payment', clearing: 'round', account: 'account' } as Record<string, string>)[category] === entry.kind) &&
    (status === 'all' || status === entry.state) && (party === 'all' || entry.parties.includes(party)) &&
    [entry.title, entry.description, entry.reference].join(' ').toLowerCase().includes(query.toLowerCase().trim())
  ), [entries, category, status, query, party]);
  useEffect(() => setPage(1), [category, status, query, party]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);

  return (
    <section className="work-surface history-surface">
      <PanelHeading title="Your history" description="Recorded service and clearing activity in this session.">
        <a className="button secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(historyCsv(filtered))}`} download="ach-recorded-history.csv">Export history <Download size={15} /></a>
      </PanelHeading>
      <div className="history-filters">
        <label className="search-field"><Search size={17} /><span className="sr-only">Search history</span><input value={query} maxLength={160} placeholder="Search work, agents or a receipt…" onChange={event => onFilter({ ...route, q: event.target.value || undefined })} /></label>
        <label><span>Type</span><select aria-label="History type" value={category} onChange={event => onFilter({ ...route, category: event.target.value === 'all' ? undefined : event.target.value })}><option value="all">All activity</option><option value="work">Work</option><option value="payments">Payments</option><option value="clearing">Clearing rounds</option><option value="account">Account setup</option></select></label>
        <label><span>Status</span><select aria-label="History status" value={status} onChange={event => onFilter({ ...route, status: event.target.value === 'all' ? undefined : event.target.value })}><option value="all">All statuses</option><option value="completed">Completed</option><option value="pending">Pending</option><option value="failed">Closed or failed</option></select></label>
        <label><span>Agent</span><select aria-label="History agent" value={party} onChange={event => onFilter({ ...route, party: event.target.value === 'all' ? undefined : event.target.value })}><option value="all">All agents</option>{data.session.participants.map(participant => <option key={participant.account_id} value={participant.account_id}>{participant.name}</option>)}</select></label>
      </div>
      <div className="list-summary"><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>{(category !== 'all' || status !== 'all' || query || party !== 'all') && <button className="text-button" onClick={() => onFilter({ view: 'history', agent: route.agent })}>Clear filters</button>}</div>
      {filtered.length ? <HistoryRows entries={filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)} route={route} onOpen={onOpen} /> : <EmptyState title={entries.length ? 'No matching activity' : 'Your history will appear here'} icon={<HistoryIcon size={25} />}><p>{entries.length ? 'Try a different type, status or search term.' : 'Run a brief to start recording work and payments.'}</p></EmptyState>}
      {pages > 1 && <div className="list-pagination"><span>Page {currentPage} of {pages}</span><div><button className="button secondary" disabled={currentPage === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="button secondary" disabled={currentPage === pages} onClick={() => setPage(value => value + 1)}>Next</button></div></div>}
      {data.events.length === 100 && <p className="history-scope-note">The snapshot includes 100 session events. Available invoices, work and clearing rounds are also included above; some older timestamps or transaction links may be unavailable.</p>}
    </section>
  );
}
