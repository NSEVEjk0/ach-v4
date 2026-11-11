'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, MouseEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Check, ChevronDown, FileText, History as HistoryIcon, House, LockKeyhole, Menu, PanelsTopLeft, ReceiptText, RefreshCw, Search, SlidersHorizontal, Wallet, X } from 'lucide-react';
import { Brand, Mark } from './Brand';
import StartSession from './StartSession';
import FundingRoutes from './FundingRoutes';
import WorkForm from './WorkForm';
import ArtifactView from './ArtifactView';
import WalletControls from './WalletControls';
import Permissions from './Permissions';
import PaymentsTable, { invoiceId, serviceNames } from './PaymentsTable';
import RoundDetails from './RoundDetails';
import type { RoundAction } from './RoundDetails';
import History, { HistoryRows, historyTarget } from './History';
import { AgentAvatar, EmptyState, PanelHeading, State } from './Interface';
import useWorkspaceNavigation, { destinations, workspaceHref } from './useWorkspaceNavigation';
import type { View, WorkspaceRoute } from './useWorkspaceNavigation';
import { api, errorText, money, preview, shortId } from '../../lib/v4';
import { sealBrief, openResult, verifyServiceKey } from '../../lib/privacy';
import type { ServiceEncryptionKey } from '../../lib/privacy';
import { buildHistory } from '../../lib/history';
import type { HistoryEntry } from '../../lib/history';
import type { Snapshot, Invoice, Round, Artifact } from '../../lib/v4';

type Privacy = 'public' | 'private';
type Operation = { id: string; payload: string };
const icons = { overview: House, work: PanelsTopLeft, wallets: Wallet, payments: ReceiptText, clearing: ArrowLeftRight, history: HistoryIcon, settings: SlidersHorizontal };
const requestId = () => crypto.randomUUID().replaceAll('-', '');
const at = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isPlainClick = (event: MouseEvent) => !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const units = (value: string) => {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error('INVALID_AMOUNT');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (amount <= 0n) throw new Error('INVALID_AMOUNT');
  return amount.toString();
};

function parseData(value: string) {
  const lines = value.trim().split('\n');
  if (!value.trim() || lines.length > 12) throw new Error('INVALID_DATASET');
  return lines.map(line => {
    const comma = line.lastIndexOf(',');
    const label = line.slice(0, comma).trim();
    const amount = line.slice(comma + 1).trim();
    if (comma < 1 || !label || label.length > 80 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(amount) || Number(amount) > 10000) throw new Error('INVALID_DATASET');
    return { label, value: Number(amount) };
  });
}

export default function AgentWorkspace() {
  const { route, navigate, back } = useWorkspaceNavigation();
  const view = route.view;
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [excludedBills, setExcludedBills] = useState<string[]>([]);
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [sheetPrivacy, setSheetPrivacy] = useState<Privacy>('public');
  const [brief, setBrief] = useState('Create an audited chart of my agent service workloads.');
  const [dataset, setDataset] = useState('Research calls,120\nChart generation,85\nQuality checks,64');
  const [mode, setMode] = useState('report');
  const [budget, setBudget] = useState('300000');
  const [pending, setPending] = useState('');
  const [withdrawal, setWithdrawal] = useState('');
  const [deposit, setDeposit] = useState('');
  const [privateResults, setPrivateResults] = useState<Record<string, Artifact>>({});
  const [privateError, setPrivateError] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [paymentQuery, setPaymentQuery] = useState('');

  const syncing = useRef(false);
  const lastSession = useRef('');
  const knownParticipants = useRef(new Set<string>());
  const returnFocus = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultsRef = useRef<Record<string, Artifact>>({});
  const hadDrawer = useRef(false);
  const runOp = useRef<Operation | null>(null);
  const clearOp = useRef<Operation | null>(null);
  const withdrawOp = useRef<Operation | null>(null);
  const depositOp = useRef<Operation | null>(null);

  const refresh = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const next = await api<Snapshot>('snapshot');
      setData(next);
      setSyncError('');
      if (lastSession.current !== next.session.id) {
        lastSession.current = next.session.id;
        setSelected([]);
        setExcludedBills([]);
        knownParticipants.current = new Set();
        resultsRef.current = {};
        setPrivateResults({});
      }
      const added = next.session.participants.map(participant => participant.account_id).filter(id => !knownParticipants.current.has(id));
      if (added.length) {
        setSelected(current => [...current, ...added]);
        for (const id of added) knownParticipants.current.add(id);
      }
      let resultError = '';
      const decoded = { ...resultsRef.current };
      for (const job of next.jobs) if (job.state === 'COMPLETE' && job.sealed_result && !decoded[job.id]) {
        try { decoded[job.id] = await openResult<Artifact>(next.deployment.network, next.deployment.vault, next.session.id, job.sealed_result); }
        catch (cause) { resultError = cause instanceof Error ? cause.message : 'PRIVATE_BROWSER_KEY_REQUIRED'; }
      }
      resultsRef.current = decoded;
      setPrivateResults(decoded);
      setPrivateError(resultError);
    } catch (cause) { setSyncError(cause instanceof Error ? cause.message : 'SERVICE_UNAVAILABLE'); }
    finally { syncing.current = false; setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 4000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [view]);

  const scope = data?.session.participants.some(participant => participant.account_id === route.agent) ? route.agent! : data?.session.participants[0]?.account_id ?? '';
  const name = (id: string) => data?.session.participants.find(participant => participant.account_id === id)?.name ?? shortId(id);
  const wallet = data?.balances.find(balance => balance.account_id === scope);
  const outside = data?.external_balances?.find(balance => balance.account_id === scope);
  const recovery = data?.recovery_withdrawals?.find(balance => balance.account_id === scope);
  const privateInvoices = useMemo(() => {
    const invoices = new Map<string, Invoice>();
    for (const result of Object.values(privateResults)) for (const invoice of result.bills ?? []) {
      const registered = data?.private_invoices?.find(record => record.nullifier === invoice.charge_id);
      invoices.set(invoiceId({ ...invoice, private: true }), { ...invoice, private: true, status: registered?.status ?? 'SIGNED' });
    }
    return [...invoices.values()];
  }, [privateResults, data?.private_invoices]);
  const ledger = [...(data?.invoices ?? []), ...privateInvoices];
  const accepted = ledger.filter(invoice => invoice.status === 'ACCEPTED' && Boolean(invoice.private) === (sheetPrivacy === 'private'));
  const candidates = accepted.filter(invoice => selected.includes(invoice.spec.buyer) && selected.includes(invoice.spec.seller));
  const included = candidates.filter(invoice => !excludedBills.includes(invoiceId(invoice)));
  const includedIds = new Set(included.map(invoiceId));
  const plan = preview(included);
  const fullPlan = preview(accepted);
  const underfunded = plan.positions.filter(position => BigInt(position.net) < 0n && -BigInt(position.net) > BigInt(data?.balances.find(balance => balance.account_id === position.account_id)?.available ?? '0'));
  const waiting = ledger.filter(invoice => ['ACCEPTED', 'READY'].includes(invoice.status) && invoice.spec.seller === scope).reduce((total, invoice) => total + BigInt(invoice.spec.amount), 0n).toString();
  const currentJobs = data?.jobs.filter(job => ['STARTED', 'WAITING'].includes(job.state)) ?? [];
  const completed = data?.jobs.filter(job => job.state === 'COMPLETE' && (job.result || privateResults[job.id])).at(-1);
  const artifact = completed ? completed.result ?? privateResults[completed.id] : null;
  const latestRound = [...(data?.rounds ?? [])].reverse().find(round => round.status === 'SETTLED' && round.input.private === (sheetPrivacy === 'private'));
  const waitingActions = data?.pending_actions?.filter(action => ['STARTED', 'WAITING'].includes(action.state)) ?? [];
  const history = data ? buildHistory(data, ledger, privateResults) : [];
  const drawer = route.item === 'invoice' || route.item === 'work';
  const detailInvoice = route.item === 'invoice' ? ledger.find(invoice => invoiceId(invoice) === route.id) : undefined;
  const opaqueInvoice = route.item === 'invoice' && !detailInvoice ? data?.private_invoices?.find(invoice => invoice.nullifier === route.id) : undefined;
  const detailJob = route.item === 'work' ? data?.jobs.find(job => job.id === route.id) : undefined;
  const detailArtifact = detailJob ? detailJob.result ?? privateResults[detailJob.id] : undefined;
  const stale = Boolean(syncError);

  const go = (next: View) => { setMobileMenu(false); navigate({ view: next, agent: scope || undefined }); };
  const closeDrawer = useCallback(() => back({ view, agent: scope || undefined, round: route.round }), [back, view, scope, route.round]);
  const openInvoice = (invoice: Invoice, target: HTMLElement) => { returnFocus.current = target; navigate({ ...route, agent: scope, item: 'invoice', id: invoiceId(invoice) }, { keepScroll: true }); };
  const openRound = (id: string) => navigate({ view: 'clearing', agent: scope || undefined, round: id });
  const openHistory = (entry: HistoryEntry, target: HTMLElement) => {
    const next = historyTarget(entry, route);
    if (!next) return;
    returnFocus.current = target;
    navigate(next, { keepScroll: entry.target !== 'round' });
  };

  useEffect(() => {
    if (!drawer) {
      if (hadDrawer.current) requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus({ preventScroll: true }));
      hadDrawer.current = false;
      return;
    }
    hadDrawer.current = true;
    const root = drawerRef.current;
    root?.querySelector<HTMLButtonElement>('[aria-label="Close details"]')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
      if (event.key === 'Tab' && root) {
        const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')];
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  }, [drawer, route.id, closeDrawer]);

  useEffect(() => {
    if (!route.round || drawer || !data?.rounds.some(round => round.input.id === route.round)) return;
    requestAnimationFrame(() => document.getElementById('round-' + route.round)?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }, [route.round, drawer, data?.rounds.length]);

  async function action(label: string, work: () => Promise<void>) {
    setPending(label); setError(''); setNotice('');
    try { await work(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'SERVICE_UNAVAILABLE'); await refresh(); }
    finally { setPending(''); }
  }
  function operation(ref: MutableRefObject<Operation | null>, payload: string) {
    if (ref.current?.payload !== payload) ref.current = { id: requestId(), payload };
    return ref.current;
  }

  async function run() {
    await action('run', async () => {
      const rows = parseData(dataset);
      const payload = JSON.stringify({ brief, mode, budget, privacy, data: rows });
      const op = operation(runOp, payload);
      let body: Record<string, unknown> = { request_id: op.id, mode, budget, privacy };
      if (privacy === 'private') {
        const signer = data!.session.participants.find(participant => participant.kind === 'research')!;
        const key = await api<ServiceEncryptionKey>('private-key');
        await verifyServiceKey(data!.deployment, data!.session.id, signer.account_id, key);
        const stored = localStorage.getItem('ach-sealed-brief:' + data!.session.id + ':' + op.id);
        const sealed = stored ? JSON.parse(stored) : await sealBrief(data!.deployment.network, data!.deployment.vault, data!.session.id, op.id, key.public_key, brief, rows);
        localStorage.setItem('ach-sealed-brief:' + data!.session.id + ':' + op.id, JSON.stringify(sealed));
        body = { ...body, sealed_brief: sealed };
      } else body = { ...body, brief, data: rows };
      await api('run', body);
      setSheetPrivacy(privacy);
      setExcludedBills([]);
      setNotice('Your agents are preparing the work. Delivered results and accepted bills will appear here.');
    });
  }
  async function clear() {
    await action('clear', async () => {
      const payload = JSON.stringify({ selected_accounts: selected, invoice_ids: included.map(invoiceId), privacy: sheetPrivacy });
      const op = operation(clearOp, payload);
      const response = await api<{ state?: string; round: Round | null }>('clear', { request_id: op.id, ...JSON.parse(payload) });
      setNotice(response.round?.status === 'SETTLED' ? 'The round settled. The resulting wallet balances are confirmed.' : 'Clearing requested. Each included agent is checking its bills, final amount and spending permissions.');
    });
  }
  async function withdraw(all = false) {
    await action('withdraw', async () => {
      const amount = all ? wallet!.available : units(withdrawal || money(wallet!.available, 6));
      const payload = JSON.stringify({ account_id: scope, amount, all });
      const op = operation(withdrawOp, payload);
      const response = await api<{ withdrawal: { status: string } }>(all ? 'recover' : 'withdraw', all ? { account_id: scope, nonce: recovery!.sequence + 1, amount } : { request_id: op.id, account_id: scope, amount });
      setNotice(response.withdrawal.status === 'COMPLETED' ? 'The tokens arrived in the agent’s NEAR account.' : response.withdrawal.status === 'RESTORED' ? 'The token transfer failed. The vault restored the available funds.' : 'The withdrawal is waiting for confirmation.');
      if (response.withdrawal.status !== 'PENDING') { withdrawOp.current = null; setWithdrawal(''); }
    });
  }
  async function redeposit() {
    await action('deposit', async () => {
      const amount = units(deposit || money(outside!.amount, 6));
      const payload = JSON.stringify({ account_id: scope, amount });
      const op = operation(depositOp, payload);
      await api('deposit', { request_id: op.id, account_id: scope, amount });
      depositOp.current = null; setDeposit('');
      setNotice('The deposit is confirmed and available in the agent’s wallet.');
    });
  }
  function roundAction(kind: RoundAction, round: Round) {
    void action(kind, async () => {
      if (kind === 'settle') { await api('settle', { id: round.input.id }); setNotice('The funded round settled. Its resulting balances are confirmed.'); }
      if (kind === 'cancel') { await api('cancel', { id: round.input.id, account_id: scope }); setNotice('This incomplete approval was cancelled and its reservation released.'); }
      if (kind === 'expire') { await api('expire', { id: round.input.id }); setNotice('The expired proposal released its temporary reservations.'); }
    });
  }

  function walletSummary(all = false) {
    const available = all ? data!.balances.reduce((total, balance) => total + BigInt(balance.available), 0n).toString() : wallet?.available;
    const reserved = all ? data!.balances.reduce((total, balance) => total + BigInt(balance.reserved), 0n).toString() : wallet?.reserved;
    const outstanding = all ? ledger.filter(invoice => ['ACCEPTED', 'READY'].includes(invoice.status)).reduce((total, invoice) => total + BigInt(invoice.spec.amount), 0n).toString() : waiting;
    return <div className="wallet-overview"><div className="wallet-summary-label"><span>{all ? 'Across your agent wallets' : name(scope) + '’s wallet'}</span><span className="tag">Test money · tUSDC</span></div><section className="wallet-summary" aria-label={all ? 'Money across your agent wallets' : `Money in ${name(scope)}’s wallet`}><div className="available-summary"><span>Available</span><strong>{available ? money(available) : '—'}<small> tUSDC</small></strong><p>Confirmed and ready to use</p></div><div><span>Reserved for clearing</span><strong>{reserved ? money(reserved) : '—'}<small> tUSDC</small></strong><p>Committed to approved rounds</p></div><div><span>{all ? 'Bills awaiting clearing' : 'Awaiting payment'}</span><strong>{money(outstanding)}<small> tUSDC</small></strong><p>Agreed bills awaiting settlement</p></div></section></div>;
  }

  function clearingSheet() {
    return <section className="work-surface clearing-surface">
      <PanelHeading title="Create a clearing round" description="Choose who clears together, then review the exact result before requesting the round."><div className="segmented-control" role="group" aria-label="Clearing invoice visibility">{(['public', 'private'] as const).map(value => <button key={value} aria-pressed={sheetPrivacy === value} onClick={() => { setSheetPrivacy(value); setExcludedBills([]); clearOp.current = null; }}>{value === 'public' ? 'Public' : 'Private'}</button>)}</div></PanelHeading>
      {sheetPrivacy === 'private' && <p className="privacy-note"><LockKeyhole size={16} />Private invoice details open in the browser that created the brief. Participants and their approved net payments remain public.</p>}
      {accepted.length ? <>
        <fieldset className="participant-selection"><legend>Agents in this clearing group</legend><div>{data!.session.participants.map(participant => <label className={selected.includes(participant.account_id) ? 'participant-selected' : undefined} key={participant.account_id}><input type="checkbox" checked={selected.includes(participant.account_id)} onChange={() => { setSelected(ids => ids.includes(participant.account_id) ? ids.filter(id => id !== participant.account_id) : [...ids, participant.account_id]); clearOp.current = null; }} /><AgentAvatar participant={participant} size="small" /><span>{participant.name}</span></label>)}</div></fieldset>
        <div className="selection-heading"><h3>Agreed bills to include</h3><span>{included.length} of {accepted.length} selected</span></div>
        <PaymentsTable invoices={candidates} name={name} onDetails={openInvoice} selected={includedIds} onSelect={id => { setExcludedBills(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]); clearOp.current = null; }} emptyTitle="Choose agents with an agreed bill between them" />
        {included.length < accepted.length && <p className="selection-notice">{accepted.length - included.length} excluded bill{accepted.length - included.length === 1 ? ' remains' : 's remain'} outstanding. This group needs <strong>{money(plan.net)} tUSDC</strong>; the full group needs {money(fullPlan.net)}. A new invoice set requires fresh approvals.</p>}
        <div className="net-sheet"><div className="net-positions"><h3>Each agent’s final amount</h3>{plan.positions.length ? plan.positions.map(position => { const net = BigInt(position.net); return <div className="net-result" key={position.account_id}><span>{name(position.account_id)}</span><strong className={net > 0n ? 'positive-text' : undefined}>{net === 0n ? 'No transfer' : <><span>{net < 0n ? 'Pays' : 'Receives'}</span> {money((net < 0n ? -net : net).toString())}<small> tUSDC</small></>}</strong></div>; }) : <p className="form-hint">Choose bills to calculate the final amounts.</p>}</div><div className="net-summary"><div><span>Gross agreed bills</span><strong>{money(plan.gross)} <small>tUSDC</small></strong></div><div className="net-funding"><span>Cash to reserve</span><strong>{money(plan.net)} <small>tUSDC</small></strong></div><div><span>Payment values offset</span><strong>{plan.reduction}%</strong></div></div></div>
        {underfunded.map(position => <p className="funding-error" role="status" key={position.account_id}>{name(position.account_id)} needs {money(position.net.slice(1))} tUSDC; {money(data!.balances.find(balance => balance.account_id === position.account_id)?.available ?? '0')} is available. Fund this wallet or choose another group.</p>)}
        {sheetPrivacy === 'private' && included.length > 6 && <p className="funding-error">A private round supports six bills. Select a smaller invoice set.</p>}
        <div className="surface-action"><p><Check size={16} /><span>Every included agent approves these bills and its final amount.<small>Only net debtors reserve money. Agents can also clear eligible bills under their standing permissions.</small></span></p><button className="button primary" disabled={!included.length || underfunded.length > 0 || Boolean(pending) || stale || (sheetPrivacy === 'private' && (data?.private_data_available === false || included.length > 6))} onClick={() => void clear()}>{pending === 'clear' ? 'Requesting clearing…' : 'Clear selected bills'}<ArrowLeftRight size={17} /></button></div>
      </> : <>
        <EmptyState title={latestRound ? 'These bills have cleared' : 'No accepted bills to clear yet'} icon={<ArrowLeftRight size={25} />}><p>{latestRound ? 'Open the completed round below to see its bills, calculation and approvals.' : 'Your agents’ accepted service payments will appear here.'}</p>{!latestRound && <button className="text-button" onClick={() => go('work')}>Create a brief <ArrowRight size={15} /></button>}</EmptyState>
        {latestRound && <div className="settlement-banner"><div><State status="SETTLED" /><h3>{money(latestRound.net_settlement_volume)} tUSDC settled {latestRound.input.invoice_ids.length} bills.</h3><p>The resulting balances are confirmed and available to use.</p></div><button className="button secondary" onClick={() => openRound(latestRound.input.id)}>See how it cleared <ArrowRight size={15} /></button></div>}
      </>}
      {waitingActions.filter(waiting => waiting.round_id?.startsWith('private-') === (sheetPrivacy === 'private')).map(waiting => <div className="operation-waiting" role="status" key={waiting.id}><State status={waiting.state} /><p>{waiting.reason ? errorText(waiting.reason) : 'Your clearing request is being checked and submitted.'}</p></div>)}
    </section>;
  }

  function roundsList() {
    const filter = ['pending', 'settled', 'closed'].includes(route.status ?? '') ? route.status! : 'all';
    const rounds = [...data!.rounds].reverse().filter(round => filter === 'all' || (filter === 'settled' ? round.status === 'SETTLED' : filter === 'pending' ? ['READY', 'COLLECTING'].includes(round.status) : ['EXPIRED', 'CANCELLED', 'STALE', 'FAILED'].includes(round.status)));
    return <section className="work-surface rounds-surface"><PanelHeading title="Clearing rounds" description="Open a round to follow its bills, offsets, approvals and settlement."><label className="inline-filter"><span className="sr-only">Round status</span><select value={filter} onChange={event => navigate({ ...route, status: event.target.value === 'all' ? undefined : event.target.value }, { replace: true, keepScroll: true })}><option value="all">All rounds</option><option value="pending">Pending</option><option value="settled">Settled</option><option value="closed">Closed</option></select></label></PanelHeading>
      {rounds.length ? <div className="round-list">{rounds.map(round => {
        const expanded = route.round === round.input.id;
        const panel = 'round-panel-' + round.input.id;
        return <article className={`round-card ${expanded ? 'round-expanded' : ''}`} id={'round-' + round.input.id} key={round.input.id}><h3><button className="round-list-item" aria-expanded={expanded} aria-controls={panel} id={'round-button-' + round.input.id} onClick={() => navigate({ ...route, item: undefined, id: undefined, round: expanded ? undefined : round.input.id }, { keepScroll: true })}><span className="round-summary-icon"><ArrowLeftRight size={20} /></span><span className="round-summary-copy"><strong>Clearing round</strong><span>{round.input.positions.length} agents · {round.input.invoice_ids.length} bills · {round.input.private ? 'Private' : 'Public'}</span><small>{round.settled_at_ms ? new Date(round.settled_at_ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Approvals due ' + at(round.input.deadline_ms)}</small></span><span className="round-summary-money"><strong className="amount">{money(round.net_settlement_volume)} <small>tUSDC</small></strong><State status={round.status} /></span><ChevronDown size={18} className="round-chevron" /></button></h3><div id={panel} aria-labelledby={'round-button-' + round.input.id} hidden={!expanded}>{expanded && <RoundDetails round={round} data={data!} invoices={ledger} name={name} scope={scope} disabled={Boolean(pending) || stale} onInvoice={openInvoice} onAction={roundAction} />}</div></article>;
      })}</div> : <EmptyState title={data!.rounds.length ? 'No rounds match this filter' : 'Your first round will appear here'} icon={<ReceiptText size={24} />}><p>{data!.rounds.length ? 'Choose another status to see your rounds.' : 'A round records the invoices, approvals and final payments for a consenting group.'}</p></EmptyState>}
    </section>;
  }

  const destination = destinations.find(destination => destination.id === view)!;
  const needsSession = ['SESSION_REQUIRED', 'SESSION_EXPIRED'].includes(syncError);
  const filteredPayments = ledger.filter(invoice => (paymentFilter === 'all' || (paymentFilter === 'private' ? invoice.private : paymentFilter === 'settled' ? invoice.status === 'SETTLED' : ['ACCEPTED', 'READY', 'SIGNED', 'PROPOSED'].includes(invoice.status))) && [serviceNames[invoice.spec.service] ?? invoice.spec.service, name(invoice.spec.buyer), name(invoice.spec.seller), invoice.spec.id].join(' ').toLowerCase().includes(paymentQuery.toLowerCase().trim()));
  const unknownPrivate = (data?.private_invoices ?? []).filter(record => !privateInvoices.some(invoice => invoiceId(invoice) === record.nullifier));

  return <div className="workspace-root">
    <div className="desk-layout" inert={drawer}>
      <a className="skip-link" href="#workspace-content">Skip to main content</a>
      <aside className={`desk-rail ${mobileMenu ? 'mobile-menu-open' : ''}`}><div className="rail-brand-row"><Brand /><button className="mobile-menu-button" aria-label={mobileMenu ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileMenu} aria-controls="workspace-navigation" onClick={() => setMobileMenu(value => !value)}>{mobileMenu ? <X size={21} /> : <Menu size={21} />}</button></div><span className="rail-section-label">Your workspace</span><nav id="workspace-navigation" aria-label="Workspace navigation">{destinations.map(({ id, label }) => { const Icon = icons[id]; return <a key={id} href={workspaceHref({ view: id, agent: scope || undefined })} className={view === id ? 'active' : undefined} aria-current={view === id ? 'page' : undefined} onClick={event => { if (!isPlainClick(event)) return; event.preventDefault(); go(id); }}><Icon size={19} />{label}{id === 'clearing' && ledger.some(invoice => invoice.status === 'ACCEPTED') && <span className="nav-count">{ledger.filter(invoice => invoice.status === 'ACCEPTED').length}</span>}</a>; })}</nav><div className="rail-bottom"><div className="rail-session"><span className="status-dot" /><div><strong>Free test session</strong><span>NEAR testnet · ACH v4</span></div></div><Link href="/">About ACH <ArrowUpRight size={14} /></Link><Link href="/developers">Developer guide <ArrowUpRight size={14} /></Link></div></aside>
      <main className="desk-main" id="workspace-content"><header className="desk-header"><span className="workspace-title">Autonomous Clearing House</span><div className="desk-connection"><span className={`connection ${data && syncError ? 'stale' : ''}`}><span className="status-dot" />{data && syncError ? 'Updates unavailable' : data?.last_sync_at_ms ? 'Updated ' + at(data.last_sync_at_ms) : needsSession ? 'Free demo' : 'Connecting'}</span><button className="icon-button" aria-label="Refresh confirmed state" title="Refresh balances and activity" onClick={() => void refresh()}><RefreshCw size={17} /></button></div></header>
        <div className="workspace-content"><div className="page-heading">{view !== 'overview' && <button className="back-link" onClick={() => back()}><ArrowLeft size={15} />Back</button>}<div className="page-heading-row"><div><h1 ref={headingRef} tabIndex={-1}>{destination.label}</h1><p>{destination.description}</p></div>{data?.session.participants.length && ['wallets', 'clearing', 'settings'].includes(view) ? <label className="account-picker"><span>{view === 'clearing' ? 'Acting agent' : 'Agent wallet'}</span><select id="wallet-scope" value={scope} onChange={event => navigate({ ...route, agent: event.target.value }, { keepScroll: true })}>{data.session.participants.map(participant => <option key={participant.account_id} value={participant.account_id}>{participant.name}</option>)}</select></label> : null}</div></div>
          {(error || (syncError && (!needsSession || data))) && <div className="message error-message" role="alert"><p>{errorText(error || syncError)}</p>{data && syncError && <span>Showing the last confirmed balances. Money actions will be available after updates resume.</span>}</div>}
          {notice && <div className="message success-message" role="status"><Check size={17} /><p>{notice}</p><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
          {!data ? <section className="first-session work-surface">{loading ? <><span className="section-kicker">Opening your workspace</span><h2>Connecting to your agents…</h2><div className="skeleton-line" /><div className="skeleton-line short" /></> : <><span className="welcome-mark"><Mark size={43} /></span><span className="section-kicker">Try ACH for free</span><h2>Your agents.<br />Their work and money.</h2><p>Start a sponsored session with three service agents. Give them a brief, download the results, and follow their payments through clearing.</p><StartSession /><span className="free-note">Test funds are provided. No wallet setup is needed.</span></>}</section> : data.session.state && data.session.state !== 'READY' ? <section className="work-surface provisioning-state"><div className="skeleton-line" /><h2>Preparing your agent wallets</h2><p>The sponsored accounts and their test funds are being confirmed. This page updates automatically.</p><State status="STARTED" /></section> : <>
            {view === 'overview' && <>
              {walletSummary(true)}
              <div className="overview-actions"><section className="overview-work"><span className="overview-icon"><PanelsTopLeft size={23} /></span><h2>Give your agents a task</h2><p>Turn your data into a chart, a reference packet and checks. Then follow the bills created by that work.</p><button className="button primary" onClick={() => go('work')}>Create a brief <ArrowRight size={16} /></button><span className="form-hint">{Math.max(0, 2 - data.jobs.length)} sponsored briefs remaining</span></section><section className="overview-clearing"><span className="overview-icon"><ArrowLeftRight size={23} /></span><h2>{ledger.some(invoice => invoice.status === 'ACCEPTED') ? 'Payments ready to clear' : data.rounds.some(round => round.status === 'SETTLED') ? 'Your payments are clearing' : 'Follow the payments'}</h2><p>{ledger.some(invoice => invoice.status === 'ACCEPTED') ? 'Review the bills and see how much funding your chosen group needs.' : data.rounds.some(round => round.status === 'SETTLED') ? 'Open a round to see how the bills offset and where the money went.' : 'Accepted bills and their clearing rounds appear after the agents deliver work.'}</p><button className="button secondary" onClick={() => go('clearing')}>{data.rounds.length ? 'View clearing rounds' : 'Review clearing'}<ArrowRight size={16} /></button></section></div>
              <section className="work-surface agent-wallets-surface"><PanelHeading title="Your agent wallets" description="Each agent has its own balance and spending permissions."><button className="text-button" onClick={() => go('wallets')}>Manage wallets <ArrowUpRight size={15} /></button></PanelHeading><div className="agent-wallet-list">{data.session.participants.map(participant => { const balance = data.balances.find(balance => balance.account_id === participant.account_id); return <a className="agent-wallet-row" key={participant.account_id} href={workspaceHref({ view: 'wallets', agent: participant.account_id })} onClick={event => { if (!isPlainClick(event)) return; event.preventDefault(); navigate({ view: 'wallets', agent: participant.account_id }); }}><AgentAvatar participant={participant} /><span><strong>{participant.name}</strong><small>{balance?.policy?.revoked ? 'Trading revoked' : 'Trading enabled'}</small></span><span className="agent-wallet-money"><strong className="amount">{balance ? money(balance.available) : '—'} <small>tUSDC</small></strong><small>Available</small></span><ArrowUpRight size={16} /></a>; })}</div></section>
              <section className="work-surface"><PanelHeading title="Recent activity"><button className="text-button" onClick={() => go('history')}>See history <ArrowUpRight size={15} /></button></PanelHeading>{history.length ? <HistoryRows entries={history.slice(0, 5)} route={route} onOpen={openHistory} /> : <EmptyState title="Ready for your first brief"><p>Completed work, accepted bills and clearing rounds will appear here.</p></EmptyState>}</section>
            </>}
            {view === 'work' && <>
              <WorkForm data={data} brief={brief} dataset={dataset} mode={mode} budget={budget} privacy={privacy} pending={pending} running={currentJobs.length > 0} stale={stale} onBrief={setBrief} onDataset={setDataset} onMode={setMode} onBudget={setBudget} onPrivacy={setPrivacy} onRun={() => void run()} />
              {currentJobs.map(job => <div className="message job-progress" role="status" key={job.id}><State status={job.state} /><p>{job.error ? errorText(job.error) : 'The agents are preparing deliverables and confirming the agreed service bills.'}</p></div>)}
              {data.jobs.filter(job => job.state === 'FAILED').map(job => <div className="message error-message" role="alert" key={job.id}><strong>This brief did not complete.</strong><p>{errorText(job.error ?? 'SERVICE_UNAVAILABLE')} Already accepted bills remain available to inspect.</p></div>)}
              {privateError && <div className="message" role="status"><LockKeyhole size={17} /><p>{errorText(privateError)}</p></div>}
              {artifact && <><ArtifactView artifact={artifact} privateResult={Boolean(completed?.sealed_result)} /><div className="next-action-card"><div><ReceiptText size={20} /><p><strong>Follow the payments for this work.</strong><span>Review the agreed bills or open their clearing round.</span></p></div><button className="button primary" onClick={() => go('clearing')}>Review clearing <ArrowRight size={16} /></button></div></>}
              {data.jobs.length > 0 && <section className="work-surface"><PanelHeading title="Brief history"><button className="text-button" onClick={() => go('history')}>Open history <ArrowUpRight size={14} /></button></PanelHeading><HistoryRows entries={history.filter(entry => entry.kind === 'work')} route={route} onOpen={openHistory} /></section>}
            </>}
            {view === 'payments' && <section className="work-surface payments-surface"><PanelHeading title="Service payments" description="Prices agreed by the buyer and provider."><span className="tag">{ledger.length + unknownPrivate.length} bill{ledger.length + unknownPrivate.length === 1 ? '' : 's'}</span></PanelHeading><div className="payment-filters"><label className="search-field"><Search size={17} /><span className="sr-only">Search payments</span><input value={paymentQuery} placeholder="Search a service or agent…" onChange={event => setPaymentQuery(event.target.value)} /></label><label className="inline-filter"><span className="sr-only">Payment status</span><select value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)}><option value="all">All payments</option><option value="pending">Awaiting clearing</option><option value="settled">Settled</option><option value="private">Private invoices</option></select></label></div><PaymentsTable invoices={filteredPayments} name={name} onDetails={openInvoice} emptyTitle={ledger.length ? 'No payments match this filter' : 'No agreed service bills yet'} />{unknownPrivate.length > 0 && <div className="private-records"><h3>Encrypted invoice records</h3><p className="form-hint">The original browser can open these invoices. Their commitments and settlement states remain recorded.</p><HistoryRows entries={history.filter(entry => entry.kind === 'payment' && unknownPrivate.some(invoice => invoice.nullifier === entry.reference))} route={route} onOpen={openHistory} /></div>}</section>}
            {view === 'clearing' && <>{clearingSheet()}{roundsList()}</>}
            {view === 'wallets' && <>{walletSummary()}<WalletControls wallet={wallet} scope={scope} outside={outside} recovery={recovery} withdrawal={withdrawal} deposit={deposit} pending={pending} stale={stale} onWithdrawal={setWithdrawal} onDeposit={setDeposit} onWithdraw={all => void withdraw(all)} onRedeposit={() => void redeposit()} onRounds={() => go('clearing')} /><FundingRoutes enabled={data.intents.enabled} /></>}
            {view === 'history' && <History entries={history} data={data} route={route} onFilter={next => navigate(next, { replace: true, keepScroll: true })} onOpen={openHistory} />}
            {view === 'settings' && <>{walletSummary()}<Permissions wallet={wallet} data={data} pending={pending} stale={stale} onRevoke={() => void action('revoke', async () => { await api('revoke', { request_id: requestId(), account_id: scope }); setNotice('Trading authority revoked. Funded rounds can still settle and available funds can be withdrawn.'); })} /></>}
          </>}
          <footer className="desk-footer"><span>Test funds have no monetary value. This session is sponsored.</span><Link href="/proof">Live deployment <ArrowUpRight size={13} /></Link></footer>
        </div>
      </main>
    </div>
    {drawer && data && <div className="drawer-overlay" onClick={event => { if (event.target === event.currentTarget) closeDrawer(); }}><div ref={drawerRef} className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="drawer-heading"><button className="back-link" onClick={closeDrawer}><ArrowLeft size={15} />Back</button><button className="icon-button" onClick={closeDrawer} aria-label="Close details"><X size={20} /></button></div>
      {route.item === 'invoice' && (detailInvoice || opaqueInvoice) ? <><span className="section-kicker">Service payment</span><h2 id="detail-title">{detailInvoice ? serviceNames[detailInvoice.spec.service] ?? detailInvoice.spec.service : 'Encrypted invoice'}</h2><div className="drawer-money">{detailInvoice ? money(detailInvoice.spec.amount) : 'Encrypted'}{detailInvoice && <small> tUSDC</small>}</div><State status={detailInvoice?.status ?? opaqueInvoice!.status} label={detailInvoice?.status === 'ACCEPTED' ? 'Ready to clear' : undefined} /><dl className="detail-list">{detailInvoice ? <><div><dt>From</dt><dd>{name(detailInvoice.spec.buyer)}<span className="mono">{detailInvoice.spec.buyer}</span></dd></div><div><dt>To</dt><dd>{name(detailInvoice.spec.seller)}<span className="mono">{detailInvoice.spec.seller}</span></dd></div><div><dt>Delivered</dt><dd>{new Date(detailInvoice.spec.ready_at_ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd></div></> : <div><dt>Participants</dt><dd>{opaqueInvoice!.parties.map(name).join(' & ')}</dd></div>}</dl>
        {detailInvoice && data.rounds.find(round => round.input.invoice_ids.includes(invoiceId(detailInvoice))) && <button className="button secondary" onClick={() => openRound(data.rounds.find(round => round.input.invoice_ids.includes(invoiceId(detailInvoice)))!.input.id)}>See clearing round <ArrowLeftRight size={16} /></button>}
        <p className="detail-note">{detailInvoice ? 'The accepted bill records an agreed price. Its proceeds become available when a funded round settles. Each purchase can be charged once.' : 'Open this session in the browser that created its private brief to see the encrypted invoice contents.'}</p><details className="technical-details"><summary>Payment identifiers <ChevronDown size={15} /></summary><dl className="detail-list"><div><dt>Invoice</dt><dd className="mono">{route.id}</dd></div><div><dt>{detailInvoice?.private || opaqueInvoice ? 'Private commitment' : 'Accepted terms hash'}</dt><dd className="mono">{detailInvoice?.hash ?? opaqueInvoice?.commitment}</dd></div>{detailInvoice && <><div><dt>Purchase</dt><dd className="mono">{detailInvoice.spec.purchase_id}</dd></div><div><dt>Delivered artifact hash</dt><dd className="mono">{detailInvoice.spec.artifact_hash}</dd></div></>}</dl></details></> : route.item === 'work' && detailJob ? <><span className="section-kicker">Work record</span><h2 id="detail-title">{detailArtifact ? 'Your delivered work' : 'Agent brief'}</h2>{detailArtifact ? <ArtifactView artifact={detailArtifact} privateResult={Boolean(detailJob.sealed_result)} /> : <div className="drawer-work-state"><State status={detailJob.state} /><p>{detailJob.sealed_result ? errorText('PRIVATE_BROWSER_KEY_REQUIRED') : detailJob.error ? errorText(detailJob.error) : 'The agents are preparing this brief.'}</p></div>}</> : <><h2 id="detail-title">Record unavailable</h2><p>This record is not part of the available session data.</p></>}
    </div></div>}
  </div>;
}
