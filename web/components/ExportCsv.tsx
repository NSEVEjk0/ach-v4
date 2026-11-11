"use client";
import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { getLedger, getSettlements, getRisk, getStatement } from "@/lib/ach";
import { formatNear } from "../../packages/client/src/amounts";
function download(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((c) => {
          const value = String(c);
          const safe = /^[=+@\t\r]/.test(value) ? "'" + value : value;
          return '"' + safe.replace(/"/g, '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
export default function ExportCsv({
  accountId,
  obligationsOnly = false,
}: {
  accountId?: string;
  obligationsOnly?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function run(kind: string) {
    setBusy(kind);
    setError("");
    try {
      let rows: (string | number)[][] = [];
      let filename = "";
      if (kind === "obligations") {
        const data = await getLedger();
        const approvals = data.some((o) => o.debtorApproved !== undefined);
        filename = "ach-obligations.csv";
        rows = [
          [
            "reference",
            "debtor",
            "creditor",
            "amount_near",
            "memo",
            "created_at_utc",
            "due_at_utc",
            "status",
            ...(approvals
              ? [
                  "debtor_approved",
                  "creditor_approved",
                  "funds_reserved",
                  "legacy_review",
                ]
              : []),
          ],
          ...data.map((o) => [
            o.id,
            o.debtor,
            o.creditor,
            formatNear(o.amount, 6),
            o.memo,
            new Date(o.createdAt).toISOString(),
            o.dueAt === null ? "" : new Date(o.dueAt).toISOString(),
            o.status,
            ...(approvals
              ? [
                  o.debtorApproved ? "yes" : "no",
                  o.creditorApproved ? "yes" : "no",
                  o.funded ? "yes" : "no",
                  o.legacyReview ? "yes" : "no",
                ]
              : []),
          ]),
        ];
      } else if (kind === "settlements") {
        const data = await getSettlements(200);
        filename = "ach-settlements.csv";
        rows = [
          [
            "round",
            "timestamp",
            "gross_volume_near",
            "net_volume_near",
            "gross_saved_pct",
            "obligation_count",
            "transfer_count",
          ],
          ...data.map((s) => [
            s.id,
            new Date(s.timestamp).toISOString(),
            formatNear(s.grossVolume, 6),
            formatNear(s.netVolume, 6),
            ((1 - s.compression) * 100).toFixed(1),
            s.obligationCount,
            s.transfers.length,
          ]),
        ];
      } else if (kind === "risk") {
        const data = await getRisk();
        const reservations = data.some((row) => row.securityVersion === 3);
        filename = "ach-risk.csv";
        rows = [
          [
            "participant",
            "balance_near",
            "gross_payable_near",
            "gross_receivable_near",
            "net_position_near",
            "credit_limit_near",
            "collateral_required_near",
            "covered",
            ...(reservations
              ? [
                  "available_balance_near",
                  "pending_payable_near",
                  "pending_receivable_near",
                  "withdrawals_enabled",
                ]
              : []),
          ],
          ...data.map((r) => [
            r.accountId,
            formatNear(r.balance, 6),
            formatNear(r.grossPayable, 6),
            formatNear(r.grossReceivable, 6),
            formatNear(r.netPosition, 6),
            BigInt(r.creditLimit) > 0n
              ? formatNear(r.creditLimit, 6)
              : "unlimited",
            formatNear(r.collateralRequired, 6),
            r.covered ? "yes" : "no",
            ...(reservations
              ? [
                  formatNear(r.availableBalance ?? "0", 6),
                  formatNear(r.pendingPayable ?? "0", 6),
                  formatNear(r.pendingReceivable ?? "0", 6),
                  r.withdrawalsEnabled ? "yes" : "no",
                ]
              : []),
          ]),
        ];
      } else if (accountId) {
        const s = await getStatement(accountId);
        filename = `ach-statement-${s.accountId.split(".")[0]}.csv`;
        rows = [
          ["field", "value"],
          ["account", s.accountId],
          ["name", s.name],
          ["balance_near", formatNear(s.balance, 6)],
          [
            "credit_limit_near",
            BigInt(s.creditLimit) > 0n
              ? formatNear(s.creditLimit, 6)
              : "unlimited",
          ],
          ["gross_payable_near", formatNear(s.grossPayable, 6)],
          ["gross_receivable_near", formatNear(s.grossReceivable, 6)],
          ["net_position_near", formatNear(s.netPosition, 6)],
          ...(s.securityVersion === 3
            ? [
                [
                  "reserved_collateral_near",
                  formatNear(s.reservedCollateral ?? "0", 6),
                ],
                [
                  "available_balance_near",
                  formatNear(s.availableBalance ?? "0", 6),
                ],
                ["withdrawals_enabled", s.withdrawalsEnabled ? "yes" : "no"],
                ["pending_outgoing", ""],
                ...(s.pendingOutgoing ?? []).map((o) => [
                  o.id,
                  `${o.creditor} ${formatNear(o.amount, 6)} NEAR; debtor approved: ${!!o.debtorApproved}; creditor approved: ${!!o.creditorApproved}`,
                ]),
                ["pending_incoming", ""],
                ...(s.pendingIncoming ?? []).map((o) => [
                  o.id,
                  `${o.debtor} ${formatNear(o.amount, 6)} NEAR; debtor approved: ${!!o.debtorApproved}; creditor approved: ${!!o.creditorApproved}`,
                ]),
              ]
            : []),
          ["", ""],
          ["open_outgoing", ""],
          ...s.openOutgoing.map((o) => [
            o.id,
            `${o.debtor.split(".")[0]} → ${o.creditor.split(".")[0]} ${formatNear(o.amount, 6)} NEAR ${o.memo}`,
          ]),
          ["", ""],
          ["open_incoming", ""],
          ...s.openIncoming.map((o) => [
            o.id,
            `${o.debtor.split(".")[0]} → ${o.creditor.split(".")[0]} ${formatNear(o.amount, 6)} NEAR ${o.memo}`,
          ]),
          ["", ""],
          ["settlements", ""],
          ...s.settlements.map((r) => [
            r.id,
            `${new Date(r.timestamp).toISOString()} · net ${formatNear(r.netVolume, 6)} NEAR · ${r.transfers.length} legs`,
          ]),
        ];
      }
      if (filename) download(filename, rows);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The export could not be prepared. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(obligationsOnly
          ? [{ kind: "obligations", label: "Export obligations CSV" }]
          : [
              { kind: "settlements", label: "Export settlements CSV" },
              { kind: "risk", label: "Export risk CSV" },
              ...(accountId
                ? [{ kind: "statement", label: "Export statement CSV" }]
                : []),
            ]
        ).map((b) => (
          <button
            key={b.kind}
            type="button"
            onClick={() => run(b.kind)}
            disabled={busy !== null}
            className="btn-secondary min-h-9 gap-1.5 px-3 py-2 text-[10px]"
          >
            {busy === b.kind ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            {b.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 max-w-sm text-[11px] text-amber-700">
          {error}
        </p>
      )}
    </div>
  );
}
