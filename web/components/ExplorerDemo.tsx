"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Interactive demo trigger for the Explorer page — the hero "do X → see Y"
 * moment. Injects a realistic circle of agent debts and lets the clearing
 * agent net and settle them atomically on-chain, then shows a big summary
 * card and refreshes to the new state.
 */
export default function ExplorerDemo() {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [summary, setSummary] = useState<{
    roundId: string;
    obligations: number;
    transfers: number;
    compression: number;
    gross: number;
    net: number;
    simulated: boolean;
    settled: boolean;
    partial: boolean;
    rounds: number;
    note: string | null;
  } | null>(null);
  const [retryMsg, setRetryMsg] = useState("");

  async function run() {
    setPhase("running");
    setSummary(null);
    setRetryMsg("");
    try {
      const res = await fetch("/api/agent-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(125_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "demo failed");
      if (!data.ok) throw new Error(data.error ?? "demo failed");
      const cleared = data.cleared;
      const gross = Number(data.grossVolume ?? 0) / 1e24;
      const net = Number(data.netVolume ?? 0) / 1e24;
      const compression = Math.round((1 - (data.compression ?? 1)) * 1000) / 10;
      setSummary({
        roundId: cleared?.roundId ?? "—",
        obligations:
          cleared?.obligationCount ??
          data.eligibleObligations ??
          data.bills?.length ??
          0,
        transfers: cleared?.transfers?.length ?? 0,
        compression,
        gross,
        net,
        simulated: Boolean(data.simulated),
        settled: Boolean(cleared),
        partial: Boolean(cleared?.partial),
        rounds: cleared?.roundIds?.length ?? 1,
        note: data.note ?? null,
      });
      setPhase("done");
      router.refresh();
    } catch (e) {
      setPhase("idle");
      setRetryMsg(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-brand-100 bg-brand-50/50">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[13px] font-semibold text-ink-950">
              See a clearing round happen
            </div>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Record six service invoices, compute the eligible net transfers,
              and follow the agent’s funding and settlement decision.
            </p>
          </div>
          <button
            onClick={run}
            disabled={phase === "running"}
            className="shrink-0 rounded-xl bg-brand-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-700/20 transition hover:bg-brand-800 active:scale-[0.98] disabled:opacity-60"
          >
            {phase === "running" ? "Settling…" : "Run Live Netting Demo"}
          </button>
        </div>

        {phase === "running" && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2.5 text-sm text-slate-600"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-700 border-t-transparent" />
            <span>
              Recording services and checking whether the round can clear…
            </span>
          </div>
        )}

        {retryMsg && phase === "idle" && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 break-words">{retryMsg}</span>
              <button
                onClick={run}
                className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 font-mono text-xs text-ink-900 transition hover:bg-brand-50"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {summary && phase === "done" && (
          <div className="mt-4 rounded-xl border border-brand-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-brand-700">
                  {summary.settled
                    ? summary.partial
                      ? "Partially settled"
                      : summary.simulated
                        ? "Simulation complete"
                        : "Settlement complete"
                    : "Settlement deferred"}
                </div>
                <div className="mt-0.5 text-sm text-slate-500">
                  {summary.settled
                    ? summary.partial
                      ? summary.note
                      : `${summary.roundId} · ${summary.simulated ? "illustrative result" : `${summary.rounds} atomic round${summary.rounds === 1 ? "" : "s"} on NEAR testnet`}`
                    : (summary.note ??
                      "Invoices recorded. Settlement will resume when the net payers are funded.")}
                </div>
              </div>
              <div className="grid w-full grid-cols-3 items-end gap-3 sm:w-auto sm:gap-6">
                <div className="text-right">
                  <div className="font-mono text-xl font-semibold text-ink-950 sm:text-2xl">
                    {summary.obligations}{" "}
                    <span className="text-sm font-medium text-slate-500">
                      →
                    </span>{" "}
                    {summary.transfers}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {summary.settled
                      ? "obligations → transfers"
                      : "invoices → proposed transfers"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xl font-semibold text-brand-700 sm:text-2xl">
                    {summary.compression}%
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {summary.settled ? "volume saved" : "projected savings"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xl font-semibold text-ink-950 sm:text-2xl">
                    {(summary.gross - summary.net).toFixed(3)}{" "}
                    <span className="text-sm font-medium text-slate-500">
                      Ⓝ
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {summary.settled
                      ? "liquidity freed"
                      : "potential liquidity saved"}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-700 transition-all duration-1000"
                style={{ width: `${Math.min(100, summary.compression)}%` }}
              />
            </div>
            <div className="mt-1 text-right text-[11px] text-slate-500">
              {summary.gross.toFixed(3)} Ⓝ gross → {summary.net.toFixed(3)} Ⓝ
              net · ledger refreshed
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
