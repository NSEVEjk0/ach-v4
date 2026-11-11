"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, X, FileText, LoaderCircle } from "lucide-react";
import type { Participant, Statement } from "@/lib/ach";
import { getStatement, yoctoToNear } from "@/lib/ach";
import { formatNear } from "../../packages/client/src/amounts";
import ExportCsv from "./ExportCsv";

export default function ParticipantsPanel({
  participants,
}: {
  participants: Participant[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Participant | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  async function open(p: Participant) {
    const id = ++requestId.current;
    setSelected(p);
    setStatement(null);
    setError("");
    setBusy(true);
    dialog.current?.showModal();
    try {
      const data = await getStatement(p.accountId);
      if (id === requestId.current) setStatement(data);
    } catch {
      if (id === requestId.current)
        setError("This statement could not be loaded. Close it and try again.");
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2 className="panel-title">Network participants</h2>
          <span className="text-[9px] text-slate-400">View statements</span>
        </div>
        <div>
          {participants.map((p) => (
            <button
              key={p.accountId}
              type="button"
              onClick={() => open(p)}
              className="flex w-full items-center justify-between gap-3 border-b border-line/70 p-4 text-left transition last:border-0 hover:bg-cream/60"
              aria-label={`View ${p.name} statement`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-cream text-xl"
                >
                  {p.icon || "🤖"}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium">
                    {p.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                    {p.kind}
                  </span>
                  <span
                    className="mt-1 block truncate font-mono text-[10px] text-slate-500"
                    title={p.accountId}
                  >
                    {p.accountId}
                  </span>
                </span>
              </span>
              <ArrowUpRight size={13} className="text-slate-400" />
            </button>
          ))}
          {!participants.length && (
            <p className="p-8 text-center text-xs text-slate-400">
              No participants available.
            </p>
          )}
        </div>
      </section>
      <dialog
        ref={dialog}
        className="dialog-sheet"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        onClose={() => {
          requestId.current++;
          setBusy(false);
        }}
        aria-labelledby="statement-title"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <p className="kicker">Participant reconciliation</p>
            <h2
              id="statement-title"
              className="mt-2 text-[24px] font-medium tracking-tight"
            >
              {selected?.name}’s statement
            </h2>
            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
              {selected?.accountId}
            </p>
            {selected?.bio && (
              <p className="mt-3 max-w-lg text-xs leading-relaxed text-slate-500">
                {selected.bio}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close statement"
            className="rounded-md p-1 text-slate-400 hover:bg-cream"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">
          {busy && (
            <div className="flex items-center justify-center gap-2 py-14 text-xs text-slate-500">
              <LoaderCircle size={16} className="animate-spin" />
              Loading the on-chain statement…
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-4 text-xs text-amber-800"
            >
              {error}
            </p>
          )}
          {statement && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { t: "Balance", v: statement.balance },
                  { t: "Net position", v: statement.netPosition },
                  { t: "Gross payable", v: statement.grossPayable },
                  { t: "Gross receivable", v: statement.grossReceivable },
                  ...(statement.securityVersion === 3
                    ? [
                        {
                          t: "Reserved collateral",
                          v: statement.reservedCollateral ?? "0",
                        },
                        {
                          t: "Available to withdraw",
                          v: statement.availableBalance ?? "0",
                        },
                      ]
                    : []),
                ].map((m) => (
                  <div key={m.t} className="rounded-lg border border-line p-4">
                    <p className="text-[10px] text-slate-400">{m.t}</p>
                    <p className="mt-2 font-mono text-xl">
                      {yoctoToNear(m.v).toFixed(4)}{" "}
                      <span className="text-[10px] text-slate-400">NEAR</span>
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-line bg-cream-dim p-4 text-xs leading-relaxed text-slate-600">
                <p>
                  <strong className="text-ink-900">Credit limit:</strong>{" "}
                  {BigInt(statement.creditLimit) > 0n
                    ? `${formatNear(statement.creditLimit)} NEAR`
                    : "Unlimited"}
                  . The limit caps this participant’s permitted net debit and is
                  checked separately from funding.
                </p>
                <p className="mt-2">
                  Balance means funds deposited with ACH. Exposure includes
                  {statement.securityVersion === 3
                    ? "approved and funded bills, including scheduled and disputed invoices"
                    : "every open bill, including scheduled invoices"}
                  . A positive net position is receivable; a negative position
                  is payable.
                </p>
                {statement.securityVersion === 3 && (
                  <p className="mt-2">
                    Reserved collateral cannot be withdrawn or spent on another
                    bill. Proposed or unbacked bills appear separately below.
                    {statement.withdrawalsEnabled === false &&
                      " Withdrawals remain paused during the contract review."}
                  </p>
                )}
              </div>
              <div className="mt-5">
                <ExportCsv accountId={statement.accountId} />
              </div>
              <h3 className="mt-7 flex items-center gap-2 text-[12px] font-semibold">
                <FileText size={14} />
                Open obligations
              </h3>
              <div className="mt-3 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Direction</th>
                      <th>Counterparty</th>
                      <th className="text-right">NEAR</th>
                      <th>Service</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...statement.openOutgoing.map((o) => ({
                        o,
                        d: "Payable",
                        p: o.creditor,
                      })),
                      ...statement.openIncoming.map((o) => ({
                        o,
                        d: "Receivable",
                        p: o.debtor,
                      })),
                    ].map(({ o, d, p }) => (
                      <tr key={o.id}>
                        <td>{d}</td>
                        <td>{p.split(".")[0]}</td>
                        <td className="text-right font-mono text-[10px]">
                          {yoctoToNear(o.amount).toFixed(4)}
                        </td>
                        <td
                          className="max-w-[200px] truncate text-slate-500"
                          title={o.memo}
                        >
                          {o.memo}
                        </td>
                      </tr>
                    ))}
                    {!statement.openIncoming.length &&
                      !statement.openOutgoing.length && (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-7 text-center text-slate-400"
                          >
                            No open obligations.
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
              {statement.securityVersion === 3 && (
                <>
                  <h3 className="mt-7 text-[12px] font-semibold">
                    Proposed obligations & funding
                  </h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Direction</th>
                          <th>Counterparty</th>
                          <th>NEAR</th>
                          <th>Required step</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...(statement.pendingOutgoing ?? []).map((o) => ({
                            o,
                            direction: "Payable",
                            counterparty: o.creditor,
                          })),
                          ...(statement.pendingIncoming ?? []).map((o) => ({
                            o,
                            direction: "Receivable",
                            counterparty: o.debtor,
                          })),
                        ].map(({ o, direction, counterparty }) => (
                          <tr key={o.id}>
                            <td>{direction}</td>
                            <td title={counterparty}>
                              {counterparty.split(".")[0]}
                            </td>
                            <td className="font-mono text-[10px]">
                              {formatNear(o.amount)}
                            </td>
                            <td>
                              {o.legacyReview
                                ? "Review existing terms"
                                : !o.debtorApproved
                                  ? "Debtor approval"
                                  : !o.creditorApproved
                                    ? "Creditor approval"
                                    : o.status === "disputed"
                                      ? "Joint dispute resolution"
                                      : "Collateral or eligible netting"}
                            </td>
                          </tr>
                        ))}
                        {!(
                          statement.pendingOutgoing?.length ||
                          statement.pendingIncoming?.length
                        ) && (
                          <tr>
                            <td
                              colSpan={4}
                              className="py-7 text-center text-slate-400"
                            >
                              No pending proposals.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <h3 className="mt-7 text-[12px] font-semibold">
                Recent settlement history
              </h3>
              <p className="mt-1 text-[10px] text-slate-400">
                Your transfers across the latest 200 network rounds.
              </p>
              <div className="mt-3 space-y-2">
                {statement.settlements.map((s) => (
                  <div
                    key={s.id}
                    className="flex justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-[11px]"
                  >
                    <span className="font-mono text-slate-500">{s.id}</span>
                    <span>
                      {s.transfers.length} transfers ·{" "}
                      {yoctoToNear(s.netVolume).toFixed(4)} NEAR
                    </span>
                  </div>
                ))}
                {!statement.settlements.length && (
                  <p className="text-xs text-slate-400">
                    No transfers in the recent settlement window.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
