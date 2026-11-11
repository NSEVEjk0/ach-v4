"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Check,
  Clock3,
  ShieldCheck,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import { yoctoToNear } from "@/lib/ach";
interface Bill {
  id: string;
  debtor: string;
  creditor: string;
  amount: number;
  memo: string;
  status?: string;
  debtorApproved?: boolean;
  creditorApproved?: boolean;
  funded?: boolean;
}
interface Step {
  kind: string;
  detail: any;
}
interface DemoResult {
  ok?: boolean;
  scenario?: string;
  bills?: Bill[];
  steps?: Step[];
  grossVolume?: string;
  netVolume?: string;
  compression?: number;
  cleared?: {
    roundId?: string;
    transfers?: unknown[];
    partial?: boolean;
    remaining?: number;
  } | null;
  note?: string;
  error?: string;
  simulated?: boolean;
}
const steps: Record<string, { label: string; icon: typeof Activity }> = {
  observe: { label: "Observe the network", icon: Activity },
  propose: { label: "Compute net positions", icon: ArrowUpRight },
  funding: { label: "Check payer funding", icon: ShieldCheck },
  settle: { label: "Settle atomically", icon: Check },
  defer: { label: "Hold scheduled obligations", icon: Clock3 },
};
export default function AgentDemo() {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(0);
  async function run() {
    setPhase("running");
    setResult(null);
    setError("");
    setVisible(0);
    try {
      const r = await fetch("/api/agent-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(125_000),
      });
      const data = await r.json();
      if (!r.ok || !data.ok)
        throw new Error(data.error ?? "The agent could not complete the demo.");
      setResult(data);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The agent could not complete the demo.",
      );
      setPhase("idle");
    }
  }
  useEffect(() => {
    if (phase !== "done" || !result?.steps?.length) return;
    const count = result.steps.length;
    setVisible(0);
    const timer = setInterval(
      () =>
        setVisible((v) => {
          if (v >= count) {
            clearInterval(timer);
            return v;
          }
          return v + 1;
        }),
      550,
    );
    return () => clearInterval(timer);
  }, [phase, result]);
  const bills = result?.bills ?? [];
  const story = result?.steps ?? [];
  const saved = result ? Math.max(0, (1 - (result.compression ?? 1)) * 100) : 0;
  return (
    <section className="panel">
      <div className="panel-heading px-6 py-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge border-brand-100 bg-brand-50 text-brand-600">
              <span className="h-1 w-1 rounded-full bg-brand-500" />
              NEAR testnet demo
            </span>
            {result?.simulated && <span className="badge">Simulated</span>}
          </div>
          <h3 className="mt-3 text-[18px] font-medium tracking-tight">
            {result?.scenario ?? "The DAO month-end"}
          </h3>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-slate-500">
            Four contributors traded services. Follow the bills, the funding
            check, and the final clearing decision.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={phase === "running"}
          className="btn-primary"
        >
          {phase === "running" ? (
            <>
              <LoaderCircle size={14} className="animate-spin" />
              Agent working…
            </>
          ) : (
            <>
              {phase === "done" ? "Replay demo" : "Run demo"}
              <ArrowUpRight size={14} />
            </>
          )}
        </button>
      </div>
      {phase === "running" && (
        <div
          role="status"
          className="flex items-center justify-center gap-3 p-10 text-center text-[12px] text-slate-500"
        >
          <LoaderCircle size={17} className="animate-spin text-brand-500" />
          <div>
            Building the obligation network and checking settlement.
            <p className="mt-2 text-[10px] text-slate-400">
              The testnet round can take a little time.
            </p>
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="m-5 flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 p-4"
        >
          <AlertCircle size={16} className="shrink-0 text-amber-600" />
          <div>
            <p className="text-[12px] font-medium text-amber-800">
              The demo could not complete
            </p>
            <p className="mt-1 break-words text-[11px] text-amber-700">
              {error}
            </p>
            <button
              type="button"
              onClick={run}
              className="mt-3 text-[11px] font-semibold text-amber-800 underline underline-offset-4"
            >
              Retry demo
            </button>
          </div>
        </div>
      )}
      {phase === "idle" && !error && (
        <div className="grid gap-6 p-6 sm:grid-cols-3">
          {[
            {
              n: "01",
              t: "Record services",
              d: "Six agent-to-agent bills form an interconnected network.",
            },
            {
              n: "02",
              t: "Reduce what moves",
              d: "Net overlapping debts and verify payer coverage.",
            },
            {
              n: "03",
              t: "Clear the round",
              d: "Settle eligible bills and wait for the scheduled invoice’s due time.",
            },
          ].map((s) => (
            <div key={s.n}>
              <p className="font-mono text-[10px] text-slate-300">{s.n}</p>
              <h4 className="mt-3 text-[12px] font-medium">{s.t}</h4>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {s.d}
              </p>
            </div>
          ))}
        </div>
      )}
      {phase === "done" && result && (
        <div className="grid gap-6 p-6 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-[11px] font-medium">
              {bills.length} services recorded
            </p>
            <div className="divide-y divide-line rounded-lg border border-line">
              {bills.map((b) => (
                <div
                  key={b.id}
                  className="flex items-start justify-between gap-3 p-3 text-[11px]"
                >
                  <div className="min-w-0">
                    <p>
                      {b.debtor.split(".")[0]}{" "}
                      <span className="text-slate-300">→</span>{" "}
                      {b.creditor.split(".")[0]}
                    </p>
                    <p className="mt-1 break-words text-[10px] text-slate-400">
                      {b.memo}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono">
                    {b.amount.toFixed(3)}{" "}
                    <span className="text-[9px] text-slate-400">NEAR</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-[11px] font-medium">
              The clearing decision
            </p>
            <div className="space-y-2">
              {story.slice(0, visible).map((s, i) => {
                const c = steps[s.kind] ?? { label: s.kind, icon: Activity };
                return (
                  <div
                    key={i}
                    className="fade-up flex gap-3 rounded-lg border border-line p-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-500">
                      <c.icon size={12} />
                    </span>
                    <div>
                      <p className="text-[11px] font-medium">{c.label}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                        {typeof s.detail === "string"
                          ? s.detail
                          : s.kind === "propose"
                            ? `${(s.detail.gross ?? 0).toFixed(3)} NEAR gross → ${(s.detail.net ?? 0).toFixed(3)} net · ${s.detail.compression ?? 0}% saved · ${s.detail.transfers ?? 0} transfers`
                            : s.kind === "settle"
                              ? `${s.detail.roundId ?? "Round"} · ${s.detail.transfers ?? 0} net transfers · ${s.detail.note ?? "settlement recorded"}`
                              : JSON.stringify(s.detail)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {visible < story.length && (
                <p
                  role="status"
                  className="py-2 text-center text-[10px] text-slate-400"
                >
                  Following the clearing cycle…
                </p>
              )}
            </div>
            <div
              className={`mt-4 rounded-lg border p-4 ${result.cleared ? "border-emerald-100 bg-emerald-50/50" : "border-amber-100 bg-amber-50/50"}`}
            >
              <p className="text-[12px] font-medium">
                {result.cleared
                  ? result.cleared.partial
                    ? "Partially settled"
                    : result.simulated
                      ? "Simulation complete"
                      : "Settlement recorded"
                  : "Settlement deferred"}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {result.cleared?.partial
                  ? result.note
                  : result.cleared
                    ? `${yoctoToNear(result.grossVolume ?? "0").toFixed(3)} NEAR gross → ${yoctoToNear(result.netVolume ?? "0").toFixed(3)} net · ${saved.toFixed(1)}% less volume.`
                    : (result.note ??
                      "The bills remain on the ledger. Settlement will wait until the net payers are funded.")}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
