import type { ReactNode } from 'react';
import { Check, Clock3, CircleAlert, LoaderCircle } from 'lucide-react';
import type { Participant } from '../../lib/v4';

const labels: Record<string, string> = {
  COLLECTING: 'Awaiting approvals', PROPOSED: 'Awaiting acceptance',
  SIGNED: 'Verifying receipt', READY: 'Fully funded', SETTLED: 'Settled',
  COMPLETE: 'Completed', COMPLETED: 'Completed', STARTED: 'In progress',
  WAITING: 'Waiting', PENDING: 'Pending', ACCEPTED: 'Accepted', AVAILABLE: 'Available',
  UNUSED: 'Available', FAILED: 'Failed', CANCELLED: 'Cancelled',
  EXPIRED: 'Expired', STALE: 'Needs a new round', RESTORED: 'Funds restored',
};

export function State({ status, label }: { status: string; label?: string }) {
  const complete = ['SETTLED', 'COMPLETE', 'COMPLETED', 'ACCEPTED', 'AVAILABLE', 'RESTORED'].includes(status);
  const failed = ['FAILED', 'CANCELLED', 'EXPIRED', 'STALE'].includes(status);
  const Icon = complete ? Check : failed ? CircleAlert : status === 'STARTED' ? LoaderCircle : Clock3;
  return (
    <span className={`state-label ${complete ? 'confirmed' : failed ? 'closed' : status === 'READY' ? 'funded' : 'waiting'}`}>
      <Icon size={13} aria-hidden="true" className={status === 'STARTED' ? 'spinning' : undefined} />
      {label ?? labels[status] ?? status.toLowerCase().replaceAll('_', ' ')}
    </span>
  );
}

export function AgentAvatar({ participant, name, size = 'normal' }: {
  participant?: Participant; name?: string; size?: 'small' | 'normal' | 'large';
}) {
  const kind = participant?.kind ?? 'external';
  return <span className={`agent-avatar agent-${kind.startsWith('test-')?'test':kind} avatar-${size}`} aria-hidden="true">{kind.startsWith('test-')?kind.slice(5):(participant?.name ?? name ?? 'A').slice(0, 1)}</span>;
}

export function EmptyState({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return <div className="empty-state">{icon && <span className="empty-icon">{icon}</span>}<h3>{title}</h3><div>{children}</div></div>;
}

export function PanelHeading({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="surface-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{children && <div className="surface-heading-actions">{children}</div>}</div>;
}
