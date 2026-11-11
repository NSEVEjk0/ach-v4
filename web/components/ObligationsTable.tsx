"use client";
import { useMemo, useState } from "react";
import { Search, ArrowRight, Clock3 } from "lucide-react";
import type { Obligation } from "@/lib/ach";
import { yoctoToNear } from "@/lib/ach";
import { formatNear } from "../../packages/client/src/amounts";

export default function ObligationsTable({
  obligations,
}: {
  obligations: Obligation[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const hasApprovals = obligations.some((o) => o.debtorApproved !== undefined);
  const now = Date.now();
  const rows = useMemo(
    () =>
      obligations.filter((o) => {
        const scheduled =
          o.status === "open" && o.dueAt !== null && o.dueAt > now;
        const matches =
          filter === "all" ||
          (filter === "scheduled" ? scheduled : o.status === filter);
        return (
          matches &&
          [o.id, o.debtor, o.creditor, o.memo]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())
        );
      }),
    [obligations, filter, query, now],
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Obligation ledger</h2>
          <p className="mt-1 text-[10px] text-slate-400">
            {rows.length} matching records · {obligations.length} loaded
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-slate-400">
          <Search size={13} />
          <input
            aria-label="Search obligations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search participant or memo…"
            className="w-[175px] bg-transparent text-[11px] text-ink-900 outline-none placeholder:text-slate-400 sm:w-[200px]"
          />
        </label>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2">
        {[
          "open",
          "pending",
          "scheduled",
          "disputed",
          "settled",
          "voided",
          "all",
        ].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] capitalize ${filter === f ? "bg-brand-50 font-medium text-brand-600" : "text-slate-500 hover:bg-cream"}`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="data-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {[
                "Reference",
                "Participants",
                "Amount · NEAR",
                "Service / memo",
                "Due",
                "Status",
                ...(hasApprovals ? ["Approval", "Backing"] : []),
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const scheduled =
                o.status === "open" && o.dueAt !== null && o.dueAt > now;
              return (
                <tr key={o.id}>
                  <td className="font-mono text-[10px] text-slate-400">
                    {o.id}
                  </td>
                  <td>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span title={o.debtor}>{o.debtor.split(".")[0]}</span>
                      <ArrowRight size={11} className="text-slate-300" />
                      <span title={o.creditor}>{o.creditor.split(".")[0]}</span>
                    </div>
                  </td>
                  <td
                    className="whitespace-nowrap font-mono text-[11px]"
                    title={`${formatNear(o.amount)} NEAR`}
                  >
                    {yoctoToNear(o.amount).toFixed(4)}
                  </td>
                  <td
                    className="max-w-[230px] truncate text-[11px] text-slate-500"
                    title={o.memo}
                  >
                    {o.memo || "—"}
                  </td>
                  <td
                    className="whitespace-nowrap text-[10px] text-slate-400"
                    title={
                      o.dueAt === null
                        ? undefined
                        : new Date(o.dueAt).toISOString()
                    }
                  >
                    {o.dueAt !== null
                      ? new Date(o.dueAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                          timeZone: "UTC",
                        }) + " UTC"
                      : "Immediate"}
                  </td>
                  <td>
                    <span
                      className={`badge whitespace-nowrap ${scheduled ? "border-amber-100 bg-amber-50 text-amber-700" : o.status === "disputed" ? "border-rose-100 bg-rose-50 text-rose-600" : o.status === "settled" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : o.status === "voided" ? "border-line bg-cream-dim text-slate-500" : "border-brand-100 bg-brand-50 text-brand-600"}`}
                    >
                      {scheduled && <Clock3 size={10} />}
                      {scheduled ? "Scheduled" : o.status}
                    </span>
                  </td>
                  {hasApprovals && (
                    <>
                      <td className="whitespace-nowrap text-[10px] text-slate-500">
                        {o.status === "voided"
                          ? "Cancelled"
                          : o.status === "settled"
                            ? o.debtorApproved && o.creditorApproved
                              ? "Both approved"
                              : "Historical settlement"
                            : o.legacyReview
                              ? "Legacy review"
                              : o.debtorApproved && o.creditorApproved
                                ? "Both approved"
                                : o.debtorApproved
                                  ? "Creditor approval needed"
                                  : o.creditorApproved
                                    ? "Debtor approval needed"
                                    : "Both approvals needed"}
                      </td>
                      <td className="whitespace-nowrap text-[10px] text-slate-500">
                        {o.status === "settled" || o.status === "voided"
                          ? "Released"
                          : o.funded
                            ? "Funds reserved"
                            : o.debtorApproved && o.creditorApproved
                              ? "Funding or due netting required"
                              : "No funds committed"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={hasApprovals ? 8 : 6}
                  className="py-12 text-center text-[12px] text-slate-400"
                >
                  {query
                    ? "No obligations match your search."
                    : "No obligations in this view."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
