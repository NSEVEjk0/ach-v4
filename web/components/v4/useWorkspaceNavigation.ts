'use client';

import { useCallback, useEffect, useState } from 'react';

export type View = 'overview' | 'work' | 'wallets' | 'payments' | 'clearing' | 'history' | 'settings';
export interface WorkspaceRoute {
  view: View;
  agent?: string;
  item?: 'invoice' | 'round' | 'work';
  id?: string;
  round?: string;
  category?: string;
  status?: string;
  q?: string;
  party?: string;
}
export const destinations: { id: View; label: string; description: string }[] = [
  { id: 'overview', label: 'Overview', description: 'Your agents, their money, and what needs your attention.' },
  { id: 'work', label: 'Work', description: 'Give your agents a task and review what they deliver.' },
  { id: 'wallets', label: 'Wallets', description: 'Manage the money available to each of your agents.' },
  { id: 'payments', label: 'Payments', description: 'The services your agents bought and the bills they agreed to.' },
  { id: 'clearing', label: 'Clearing', description: 'Bring agreed payments together and settle each agent’s final amount.' },
  { id: 'history', label: 'History', description: 'Find recorded work, payments, clearing rounds, and their receipts.' },
  { id: 'settings', label: 'Settings', description: 'Review the permissions and spending limits for your selected agent.' },
];

const views = new Set(destinations.map(({ id }) => id));
const legacy: Record<string, View> = { workspace: 'work', wallet: 'wallets', trades: 'payments', rounds: 'clearing', activity: 'history' };

function readRoute(): WorkspaceRoute {
  const url = new URL(window.location.href);
  const requested = url.searchParams.get('view') ?? url.hash.slice(1);
  const view = views.has(requested as View) ? requested as View : legacy[requested] ?? 'overview';
  const item = url.searchParams.get('item');
  const id = url.searchParams.get('id') ?? undefined;
  return {
    view,
    agent: url.searchParams.get('agent') ?? undefined,
    ...(['invoice', 'round', 'work'].includes(item ?? '') && id ? { item: item as WorkspaceRoute['item'], id } : {}),
    round: url.searchParams.get('round') ?? (item === 'round' ? id : undefined),
    category: url.searchParams.get('category') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    party: url.searchParams.get('party') ?? undefined,
  };
}

export function workspaceHref(route: WorkspaceRoute) {
  const params = new URLSearchParams();
  if (route.view !== 'overview') params.set('view', route.view);
  for (const key of ['agent', 'item', 'id', 'round', 'category', 'status', 'q', 'party'] as const) {
    if (route[key]) params.set(key, route[key]!);
  }
  const query = params.toString();
  return '/workspace' + (query ? '?' + query : '');
}

export default function useWorkspaceNavigation() {
  const [route, setRoute] = useState<WorkspaceRoute>({ view: 'overview' });

  useEffect(() => {
    setRoute(readRoute());
    if (!window.history.state?.achEntry) {
      window.history.replaceState({ ...window.history.state, achEntry: true, achDepth: 0 }, '', window.location.href);
    }
    const onHistory = () => {
      setRoute(readRoute());
      const y = window.history.state?.achScroll ?? 0;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' })));
    };
    window.addEventListener('popstate', onHistory);
    window.addEventListener('hashchange', onHistory);
    return () => {
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('hashchange', onHistory);
    };
  }, []);

  const navigate = useCallback((next: WorkspaceRoute, options: { replace?: boolean; keepScroll?: boolean } = {}) => {
    const href = workspaceHref(next);
    const current = window.location.pathname + window.location.search;
    if (href === current && !window.location.hash) return;
    const previous = { ...window.history.state, achEntry: true, achScroll: window.scrollY };
    window.history.replaceState(previous, '', window.location.href);
    if (options.replace) {
      window.history.replaceState({ ...previous, achScroll: options.keepScroll ? window.scrollY : 0 }, '', href);
    } else {
      window.history.pushState({ ...previous, achDepth: (previous.achDepth ?? 0) + 1, achFrom: readRoute().view, achScroll: options.keepScroll ? window.scrollY : 0 }, '', href);
    }
    setRoute(next);
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const back = useCallback((fallback: WorkspaceRoute = { view: 'overview' }) => {
    if ((window.history.state?.achDepth ?? 0) > 0) window.history.back();
    else navigate(fallback, { replace: true, keepScroll: Boolean(route.item || route.round) });
  }, [navigate, route.item, route.round]);

  return { route, navigate, back };
}
