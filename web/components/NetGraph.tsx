"use client";
import { useId, useMemo, useState } from "react";
import type { Participant, Obligation, NetResult } from "@/lib/ach";
import { yoctoToNear } from "@/lib/ach";
type Edge = {
  id: string;
  from: string;
  to: string;
  amount: bigint;
  count: number;
  scheduled: boolean;
};

export default function NetGraph({
  participants,
  obligations,
  net,
}: {
  participants: Participant[];
  obligations: Obligation[];
  net: NetResult;
}) {
  const [mode, setMode] = useState<"gross" | "net">("gross");
  const [hover, setHover] = useState<string | null>(null);
  const arrow = useId().replace(/:/g, "");
  const nodes = useMemo(
    () =>
      participants.map((p, i) => {
        const angle =
          (i / Math.max(1, participants.length)) * Math.PI * 2 - Math.PI / 2;
        return {
          ...p,
          x: 225 + 134 * Math.cos(angle),
          y: 195 + 130 * Math.sin(angle),
        };
      }),
    [participants],
  );
  const map = useMemo(
    () => new Map(nodes.map((n) => [n.accountId, n])),
    [nodes],
  );
  const gross = useMemo(() => {
    const grouped = new Map<string, Edge>();
    for (const o of obligations.filter(
      (o) =>
        o.status === "open" ||
        (o.status === "pending" &&
          o.debtorApproved &&
          o.creditorApproved &&
          !o.legacyReview),
    )) {
      const scheduled = o.dueAt !== null && o.dueAt > Date.now();
      const id = `${o.debtor}/${o.creditor}/${scheduled}`;
      const old = grouped.get(id);
      if (old) {
        old.amount += BigInt(o.amount);
        old.count++;
      } else
        grouped.set(id, {
          id,
          from: o.debtor,
          to: o.creditor,
          amount: BigInt(o.amount),
          count: 1,
          scheduled,
        });
    }
    return [...grouped.values()].filter(
      (e) => map.has(e.from) && map.has(e.to),
    );
  }, [obligations, map]);
  const edges: Edge[] =
    mode === "gross"
      ? gross
      : net.transfers
          .filter((t) => map.has(t.from) && map.has(t.to))
          .map((t, i) => ({
            id: "net" + i,
            from: t.from,
            to: t.to,
            amount: BigInt(t.amount),
            count: 1,
            scheduled: false,
          }));
  const max = edges.reduce((m, e) => (e.amount > m ? e.amount : m), 0n);
  const active = edges.find((e) => e.id === hover);
  const connections = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = [edge.from, edge.to].sort().join("/");
    const group = connections.get(key) ?? [];
    group.push(edge);
    connections.set(key, group);
  }
  const bends = new Map<string, number>();
  for (const group of connections.values()) {
    group.forEach((edge, index) => {
      const direction = edge.from < edge.to ? 1 : -1;
      bends.set(
        edge.id,
        group.length > 1
          ? (index - (group.length - 1) / 2) * 64 * direction
          : 24,
      );
    });
  }
  function path(e: Edge) {
    const a = map.get(e.from)!,
      b = map.get(e.to)!;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy) || 1;
    const bend = bends.get(e.id) ?? 24;
    return `M${a.x} ${a.y} Q${(a.x + b.x) / 2 - (dy / len) * bend} ${(a.y + b.y) / 2 + (dx / len) * bend} ${b.x} ${b.y}`;
  }
  return (
    <div className="px-4 pb-4 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex rounded-lg bg-cream p-1"
          role="group"
          aria-label="Live network view"
        >
          {(["gross", "net"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setHover(null);
              }}
              type="button"
              aria-pressed={mode === m}
              className={`rounded-md px-3 py-1.5 text-[10px] font-medium ${mode === m ? "bg-white text-ink-900 shadow-sm" : "text-slate-400"}`}
            >
              {m === "gross" ? "Gross network" : "Net transfers"}
            </button>
          ))}
        </div>
        <span className="text-[9px] text-slate-400">
          {mode === "gross"
            ? "Hover or tap a connection"
            : "Ready-to-clear positions"}
        </span>
      </div>
      <div className="preview-canvas mt-3 rounded-lg bg-cream/20">
        <svg
          viewBox="0 0 450 390"
          className="mx-auto w-full max-w-[430px]"
          role="group"
          aria-label={
            mode === "gross"
              ? "Live obligations between clearing participants"
              : "Computed net transfers between clearing participants"
          }
        >
          <defs>
            <marker
              id={arrow}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path
                d="M0 0 10 5 0 10z"
                fill={mode === "net" ? "#9c7350" : "#cfb096"}
              />
            </marker>
          </defs>
          <circle
            cx="225"
            cy="195"
            r="133"
            fill="none"
            stroke="#f1e4d6"
            strokeDasharray="3 5"
          />
          {edges.map((e) => {
            const d = path(e),
              isActive = hover === e.id,
              width = max > 0n ? 1 + (Number(e.amount) / Number(max)) * 2.5 : 1;
            return (
              <g
                key={e.id}
                role="button"
                tabIndex={0}
                aria-label={`${e.from.split(".")[0]} to ${e.to.split(".")[0]}, ${yoctoToNear(e.amount).toFixed(4)} NEAR, ${e.count} ${mode === "gross" ? "obligations" : "transfer"}${e.scheduled ? ", scheduled" : ""}`}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch") setHover(e.id);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType !== "touch") setHover(null);
                }}
                onFocus={() => setHover(e.id)}
                onBlur={() => setHover(null)}
                onClick={() => setHover(e.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setHover(e.id);
                  }
                }}
                className="cursor-pointer focus:outline-none"
              >
                <path
                  d={d}
                  stroke="transparent"
                  strokeWidth="24"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                  fill="none"
                />
                <path
                  d={d}
                  stroke={
                    isActive
                      ? "#83593b"
                      : e.scheduled
                        ? "#e2cdb8"
                        : mode === "net"
                          ? "#9c7350"
                          : "#c9a87c"
                  }
                  strokeWidth={isActive ? width + 1 : width}
                  strokeOpacity={isActive ? 1 : 0.75}
                  strokeDasharray={e.scheduled ? "3 4" : undefined}
                  fill="none"
                  markerEnd={`url(#${arrow})`}
                />
              </g>
            );
          })}
          <rect
            x="200"
            y="171"
            width="50"
            height="48"
            rx="12"
            fill="#faf4ec"
            stroke="#f1e4d6"
            pointerEvents="none"
          />
          <text
            x="225"
            y="200"
            textAnchor="middle"
            fontSize="13"
            fontWeight="600"
            fill="#5c4a3c"
            letterSpacing="-.5"
            pointerEvents="none"
          >
            ACH
          </text>
          {nodes.map((n) => (
            <g key={n.accountId} pointerEvents="none">
              <circle
                cx={n.x}
                cy={n.y}
                r="27"
                fill="#fff"
                stroke="#e2cdb8"
                strokeWidth="1.5"
              />
              <circle cx={n.x} cy={n.y} r="20" fill="#fdfbf7" />
              <text
                x={n.x}
                y={n.y + 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="500"
                fill="#5c4a3c"
              >
                {n.name.slice(0, 1).toUpperCase()}
              </text>
              <rect
                x={n.x - 42}
                y={n.y + 32}
                width="84"
                height="19"
                rx="5"
                fill="#fff"
              />
              <text
                x={n.x}
                y={n.y + 45}
                textAnchor="middle"
                fontSize="10"
                fill="#5c4a3c"
              >
                {n.name.slice(0, 15)}
              </text>
            </g>
          ))}
          {active && (
            <g pointerEvents="none">
              <rect
                x="142"
                y="166"
                width="166"
                height="63"
                rx="9"
                fill="#33261d"
              />
              <text
                x="225"
                y="187"
                textAnchor="middle"
                fontSize="9"
                fill="#e2cdb8"
              >
                {active.from.split(".")[0]} → {active.to.split(".")[0]}
              </text>
              <text
                x="225"
                y="205"
                textAnchor="middle"
                fontSize="12"
                fill="#fff"
                fontFamily="var(--font-geist),monospace"
              >
                {yoctoToNear(active.amount).toFixed(4)} NEAR
              </text>
              <text
                x="225"
                y="218"
                textAnchor="middle"
                fontSize="8"
                fill="#e2cdb8"
              >
                {active.count} {mode === "gross" ? "obligations" : "transfer"}
                {active.scheduled ? " · scheduled" : ""}
              </text>
            </g>
          )}
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 pt-3 text-[9px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-brand-300" />
          {mode === "gross" ? "Aggregated obligations" : "Net transfers"}
        </span>
        {mode === "gross" && gross.some((e) => e.scheduled) && (
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed border-slate-300" />
            Scheduled
          </span>
        )}
        {edges.length === 0 && (
          <span>
            {mode === "net"
              ? "No transfers required right now"
              : "No open obligations"}
          </span>
        )}
      </div>
    </div>
  );
}
