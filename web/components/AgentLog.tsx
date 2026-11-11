"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Check,
  ArrowUpRight,
  CirclePause,
  AlertCircle,
} from "lucide-react";
interface AgentEvent {
  t: number;
  kind: string;
  [key: string]: unknown;
}
const STORY = new Set(["observe", "propose", "settle", "defer", "error"]);
const types: Record<
  string,
  { label: string; color: string; icon: typeof Activity }
> = {
  observe: {
    label: "Observed",
    color: "text-slate-500 bg-slate-50",
    icon: Activity,
  },
  propose: {
    label: "Proposed",
    color: "text-brand-600 bg-brand-50",
    icon: ArrowUpRight,
  },
  settle: {
    label: "Settled",
    color: "text-emerald-600 bg-emerald-50",
    icon: Check,
  },
  defer: {
    label: "Deferred",
    color: "text-amber-600 bg-amber-50",
    icon: CirclePause,
  },
  error: {
    label: "Error",
    color: "text-rose-600 bg-rose-50",
    icon: AlertCircle,
  },
};
function lines(e: AgentEvent): string[] {
  const out: string[] = [];
  if (typeof e.open === "number")
    out.push(`Observed ${e.open} open obligations.`);
  if (typeof e.transfers === "number")
    out.push(
      `${e.transfers} net transfers ${e.kind === "settle" ? "executed" : "required"}.`,
    );
  if (typeof e.compression === "number")
    out.push(`${e.compression}% less settlement volume.`);
  if (typeof e.roundId === "string")
    out.push(`Round ${e.roundId} settled atomically on NEAR.`);
  if (e.reason === "underfunded")
    out.push("Waiting for sufficient payer funding before settlement.");
  if (Array.isArray(e.shortfalls))
    out.push(
      `Funding required: ${e.shortfalls.map((s: unknown) => String(s).split(".")[0]).join(", ")}.`,
    );
  if (e.kind === "bill")
    out.push(
      `${String(e.debtor ?? "").split(".")[0]} → ${String(e.creditor ?? "").split(".")[0]} · ${typeof e.amount === "number" ? e.amount.toFixed(4) : (e.amount ?? "")} NEAR · ${e.memo ?? "service"}`,
    );
  if (typeof e.note === "string") out.push(e.note);
  if (typeof e.error === "string") out.push(e.error);
  if (typeof e.message === "string") out.push(e.message);
  if (!out.length)
    out.push(
      e.kind === "hold"
        ? "No clearing action required."
        : "Recorded in the agent audit trail.",
    );
  return out;
}
function age(t: number) {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${Math.floor(s / 3600)}h ago`;
}
function eventKey(event: AgentEvent) {
  return `${event.t}:${event.kind}:${event.roundId ?? event.id ?? ""}`;
}
export default function AgentLog({
  initialLog,
  grow = false,
}: {
  initialLog: AgentEvent[];
  agentUrl?: string;
  grow?: boolean;
}) {
  const [log, setLog] = useState(initialLog);
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(() => {
    const first = [...initialLog]
      .reverse()
      .find((event) => STORY.has(event.kind));
    return first ? eventKey(first) : null;
  });
  const [connected, setConnected] = useState(initialLog.length > 0);
  useEffect(() => {
    let stopped = false,
      inFlight = false;
    const controller = new AbortController();
    async function update() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const r = await fetch("/api/agent?resource=log", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8_000),
          ]),
        });
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error();
        if (!stopped) {
          setLog(data);
          setConnected(true);
        }
      } catch {
        if (!stopped) setConnected(false);
      } finally {
        inFlight = false;
      }
    }
    update();
    const timer = setInterval(update, 5_000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  const groups = useMemo(() => {
    const result: { first: AgentEvent; count: number }[] = [];
    for (const e of [...log]
      .reverse()
      .filter((e) => all || STORY.has(e.kind))) {
      const last = result[result.length - 1];
      if (!all && e.kind === "observe" && last?.first.kind === e.kind)
        last.count++;
      else result.push({ first: e, count: 1 });
    }
    return result;
  }, [log, all]);
  return (
    <section className={`panel ${grow ? "min-h-[510px]" : ""}`}>
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Decision timeline</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
            <span
              className={`h-1 w-1 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            {connected
              ? "Live updates every 5 seconds"
              : "Reconnecting to the agent"}
          </p>
        </div>
        <div
          className="flex rounded-lg bg-cream p-1"
          role="group"
          aria-label="Agent log filter"
        >
          {[false, true].map((v) => (
            <button
              type="button"
              key={String(v)}
              onClick={() => {
                setAll(v);
                setExpanded(null);
              }}
              aria-pressed={all === v}
              className={`rounded-md px-3 py-1.5 text-[10px] ${all === v ? "bg-white font-medium text-ink-900 shadow-sm" : "text-slate-400"}`}
            >
              {v ? "All events" : "Key decisions"}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[750px] overflow-y-auto px-5 py-2">
        {groups.map((g) => {
          const c = types[g.first.kind] ?? {
            label: g.first.kind,
            color: "text-slate-400 bg-cream",
            icon: Activity,
          };
          const content = lines(g.first);
          const key = eventKey(g.first);
          return (
            <div
              key={key}
              className="relative border-b border-line/70 py-5 last:border-0"
            >
              <button
                type="button"
                onClick={() => setExpanded(expanded === key ? null : key)}
                aria-expanded={expanded === key}
                className="flex w-full items-start gap-3 text-left"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${c.color}`}
                >
                  <c.icon size={14} strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[12px] font-medium text-ink-900">
                    {c.label}
                    {g.count > 1 && (
                      <span className="badge py-0.5 text-[9px]">
                        ×{g.count}
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-500">
                    {content[0]}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 pt-1 text-slate-400">
                  <time
                    suppressHydrationWarning
                    dateTime={new Date(g.first.t).toISOString()}
                    className="text-[9px]"
                  >
                    {age(g.first.t)}
                  </time>
                  <ChevronDown
                    size={12}
                    className={expanded === key ? "rotate-180" : ""}
                  />
                </span>
              </button>
              {expanded === key && (
                <div className="ml-11 mt-3 rounded-lg border border-line bg-cream/50 p-3.5">
                  <div className="space-y-1.5">
                    {content.slice(1).map((line, j) => (
                      <p
                        key={j}
                        className="break-words text-[11px] leading-relaxed text-slate-500"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] text-slate-400">
                    {new Date(g.first.t).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC · {g.count} consecutive {g.first.kind} event
                    {g.count === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {!groups.length && (
          <div className="flex min-h-[340px] flex-col items-center justify-center text-center">
            <Activity
              size={24}
              strokeWidth={1.3}
              className="mb-4 text-slate-300"
            />
            <p className="text-[13px] font-medium text-ink-900">
              {log.length
                ? "No key decisions in the current window"
                : "No activity available yet"}
            </p>
            <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-slate-400">
              {log.length
                ? "Switch to All events to see billing and idle checks."
                : "The timeline updates automatically when the agent publishes an observation."}
            </p>
          </div>
        )}
      </div>
      <div className="border-t border-line px-5 py-3 text-[9px] text-slate-400">
        {groups.length} entries ·{" "}
        {all ? "Latest agent activity" : "Clearing decisions and errors"}
      </div>
    </section>
  );
}
