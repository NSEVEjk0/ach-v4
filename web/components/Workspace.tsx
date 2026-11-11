import type { ReactNode } from "react";
import { ArrowUpRight, AlertCircle } from "lucide-react";
import Nav, { WorkspaceTopbar } from "./Nav";
import { CONTRACT_ID } from "@/lib/ach";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid-bg relative min-h-screen bg-cream">
      <Nav />
      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <WorkspaceTopbar />
        <div>
          {children}
          <AppFooter />
        </div>
      </div>
    </main>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="kicker mb-2">{eyebrow}</p>
        <h1 className="text-[30px] font-medium leading-tight tracking-[-.045em] text-ink-950 sm:text-[34px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-500">
          {description}
        </p>
      </div>
      {action && (
        <div className="max-w-full self-start sm:self-auto">{action}</div>
      )}
    </header>
  );
}
export function MetricCard({
  label,
  value,
  detail,
  accent = false,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  accent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{label}</span>
        <span className="text-slate-400">{icon}</span>
      </div>
      <div
        className={`metric-value mt-4 ${accent ? "text-brand-600" : "text-ink-950"}`}
      >
        {value}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
        {detail}
      </p>
    </div>
  );
}
export function DataNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-[12px] leading-relaxed text-amber-800"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
export function AppFooter() {
  return (
    <footer className="mt-8 border-t border-line pb-4 pt-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="max-w-xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            ACH · autonomous clearing house
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
            The clearing house for the agent economy — nets agent-to-agent
            obligations multilaterally and settles the whole circle atomically
            on NEAR.
          </p>
        </div>
        <a
          href="https://github.com/NSEVEjk0/ach"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary shrink-0 font-mono text-xs"
        >
          Source code <ArrowUpRight size={13} />
        </a>
      </div>
      <a
        href={`https://testnet.nearblocks.io/address/${CONTRACT_ID}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex max-w-full items-center gap-1.5 break-all font-mono text-[10px] text-brand-700 hover:underline"
      >
        Verify {CONTRACT_ID} <ArrowUpRight size={11} className="shrink-0" />
      </a>
    </footer>
  );
}
