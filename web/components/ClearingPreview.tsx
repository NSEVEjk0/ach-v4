"use client";
import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";

const nodes = [
  { name: "Alice", role: "Research", x: 90, y: 105 },
  { name: "Bob", role: "Data", x: 375, y: 105 },
  { name: "Carol", role: "Design", x: 375, y: 290 },
  { name: "Dave", role: "Compute", x: 90, y: 290 },
];
const gross = [
  { from: 0, to: 1, amount: ".020" },
  { from: 1, to: 2, amount: ".015" },
  { from: 2, to: 0, amount: ".010" },
  { from: 3, to: 1, amount: ".006" },
  { from: 0, to: 3, amount: ".009" },
];
const net = [
  { from: 0, to: 1, amount: ".011" },
  { from: 0, to: 2, amount: ".005" },
  { from: 0, to: 3, amount: ".003" },
];

export default function ClearingPreview() {
  const [mode, setMode] = useState<"gross" | "net">("gross");
  const edges = mode === "gross" ? gross : net;
  return (
    <div className="clearing-preview overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <span className="text-[12px] font-medium text-ink-900">
          A clearer way to settle
        </span>
        <span className="badge border-0 bg-cream text-[9px]">
          Interactive example
        </span>
      </div>
      <div
        className="mx-5 mt-4 flex rounded-lg bg-cream p-1"
        role="group"
        aria-label="Example network view"
      >
        {(["gross", "net"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`flex-1 rounded-md px-3 py-2 text-[11px] font-medium transition ${mode === m ? "bg-white text-ink-900 shadow-sm" : "text-slate-400"}`}
          >
            {m === "gross" ? "Gross obligations" : "Net settlement"}
          </button>
        ))}
      </div>
      <div className="preview-canvas mx-3">
        <svg
          viewBox="0 0 465 380"
          role="img"
          aria-label={
            mode === "gross"
              ? "Five obligations between Alice, Bob, Carol, and Dave"
              : "Three net transfers from Alice reduce settlement volume by 68.3%"
          }
          className="w-full"
        >
          <defs>
            <marker
              id="preview-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path
                d="M0 0 10 5 0 10z"
                fill={mode === "net" ? "#5679e2" : "#bec8db"}
              />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const a = nodes[e.from],
              b = nodes[e.to];
            const dx = b.x - a.x,
              dy = b.y - a.y,
              len = Math.hypot(dx, dy);
            const sx = a.x + (dx / len) * 48,
              sy = a.y + (dy / len) * 30,
              tx = b.x - (dx / len) * 48,
              ty = b.y - (dy / len) * 30;
            const mx = (sx + tx) / 2 - (dy / len) * 22,
              my = (sy + ty) / 2 + (dx / len) * 22;
            return (
              <g key={mode + i}>
                <path
                  d={`M${sx} ${sy} Q${mx} ${my} ${tx} ${ty}`}
                  stroke={mode === "net" ? "#7696ee" : "#c5cedf"}
                  strokeWidth={mode === "net" ? "2" : "1.2"}
                  fill="none"
                  markerEnd="url(#preview-arrow)"
                />
                <rect
                  x={mx - 23}
                  y={my - 10}
                  width="46"
                  height="20"
                  rx="5"
                  fill="#fff"
                />
                <text
                  x={mx}
                  y={my + 4}
                  textAnchor="middle"
                  fontFamily="var(--font-geist),monospace"
                  fontSize="10"
                  fill={mode === "net" ? "#4164d3" : "#8995aa"}
                >
                  {e.amount}
                </text>
              </g>
            );
          })}
          <rect x="207" y="167" width="51" height="51" rx="13" fill="#121926" />
          <text
            x="232.5"
            y="197"
            textAnchor="middle"
            fill="#fff"
            fontSize="14"
            fontWeight="600"
            letterSpacing="-.5"
          >
            ACH
          </text>
          {nodes.map((n, i) => (
            <g key={n.name}>
              <rect
                x={n.x - 43}
                y={n.y - 27}
                width="86"
                height="54"
                rx="10"
                fill="#fff"
                stroke="#dde3ee"
              />
              <circle
                cx={n.x - 25}
                cy={n.y - 7}
                r="9"
                fill={mode === "net" && i === 0 ? "#e2eaff" : "#f1f3f7"}
              />
              <text
                x={n.x - 25}
                y={n.y - 3}
                fontSize="9"
                fontWeight="600"
                textAnchor="middle"
                fill="#556176"
              >
                {n.name[0]}
              </text>
              <text
                x={n.x - 9}
                y={n.y - 4}
                fill="#202939"
                fontSize="11"
                fontWeight="500"
              >
                {n.name}
              </text>
              <text
                x={n.x}
                y={n.y + 15}
                fill="#8995aa"
                textAnchor="middle"
                fontSize="8.5"
              >
                {n.role} agent
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mx-5 -mt-1 grid grid-cols-[1fr_auto_1fr] items-center rounded-lg border border-line bg-cream/60 p-4">
        <div>
          <p className="text-[9px] text-slate-500">Gross obligations</p>
          <p className="mt-1 font-mono text-[23px] tracking-tight">
            0.060 <span className="text-[10px] text-slate-400">NEAR</span>
          </p>
        </div>
        <ArrowRight size={15} className="text-slate-300" />
        <div className="text-right">
          <p className="text-[9px] text-slate-500">Net settlement</p>
          <p className="mt-1 font-mono text-[23px] tracking-tight text-brand-600">
            0.019 <span className="text-[10px] text-brand-400">NEAR</span>
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between px-5 py-4">
        <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <ShieldCheck size={12} /> One atomic settlement
        </span>
        <span className="text-[10px] font-medium text-brand-600">
          68.3% less capital required
        </span>
      </div>
    </div>
  );
}
