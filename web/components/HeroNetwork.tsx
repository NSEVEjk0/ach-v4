"use client";

import { useId, useState } from "react";

const nodes = [
  { id: "alice", x: 120, y: 110, emoji: "🤖" },
  { id: "bob", x: 380, y: 40, emoji: "⚙️" },
  { id: "carol", x: 640, y: 110, emoji: "🎨" },
  { id: "dave", x: 380, y: 200, emoji: "🖥️" },
];
type DiagramTransfer = {
  from: string;
  to: string;
  amount: string;
  label?: { x: number; y: number };
};
const gross: DiagramTransfer[] = [
  { from: "alice", to: "bob", amount: "0.020" },
  { from: "bob", to: "carol", amount: "0.015" },
  { from: "carol", to: "alice", amount: "0.010", label: { x: 465, y: 102 } },
  { from: "dave", to: "bob", amount: "0.006", label: { x: 414, y: 151 } },
  { from: "alice", to: "dave", amount: "0.009" },
];
const net: DiagramTransfer[] = [
  { from: "alice", to: "bob", amount: "0.011" },
  { from: "alice", to: "carol", amount: "0.005", label: { x: 465, y: 102 } },
  { from: "alice", to: "dave", amount: "0.003" },
];

export default function HeroNetwork() {
  const [mode, setMode] = useState<"gross" | "net">("gross");
  const marker = useId().replace(/:/g, "");
  const edges = mode === "gross" ? gross : net;
  return (
    <figure>
      <div className="mx-auto mb-5 flex w-fit max-w-full gap-1 rounded-xl border border-line bg-cream-dim p-1">
        {(["gross", "net"] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={mode === view}
            onClick={() => setMode(view)}
            className={`min-h-9 rounded-lg px-4 py-2 font-mono text-[11px] transition ${mode === view ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-ink-950"}`}
          >
            {view === "gross" ? "Gross obligations" : "Net settlement"}
          </button>
        ))}
      </div>
      <svg
        viewBox="0 0 760 280"
        className="w-full"
        role="img"
        aria-label={
          mode === "gross"
            ? "Five obligations between Alice, Bob, Carol and Dave"
            : "Three net transfers from Alice to Bob, Carol and Dave"
        }
      >
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0 0 10 5 0 10z" fill="#9c7350" />
          </marker>
        </defs>
        {edges.map((edge, i) => {
          const from = nodes.find((node) => node.id === edge.from)!;
          const to = nodes.find((node) => node.id === edge.to)!;
          const dx = to.x - from.x,
            dy = to.y - from.y,
            length = Math.hypot(dx, dy);
          return (
            <g key={`${edge.from}/${edge.to}`}>
              <line
                x1={from.x + (dx / length) * 32}
                y1={from.y + (dy / length) * 32}
                x2={to.x - (dx / length) * 33}
                y2={to.y - (dy / length) * 33}
                stroke={mode === "net" ? "#83593b" : "#c9a87c"}
                strokeWidth={mode === "net" ? "2.5" : "1.5"}
                strokeDasharray={mode === "gross" ? "6 5" : undefined}
                markerEnd={`url(#${marker})`}
                className={mode === "gross" ? "edge-anim" : undefined}
                style={{ animationDelay: `${i * 0.15}s` }}
              />
              <text
                x={edge.label?.x ?? (from.x + to.x) / 2}
                y={edge.label?.y ?? (from.y + to.y) / 2 - 8}
                textAnchor="middle"
                fontSize="11"
                fill="#83593b"
                fontFamily="var(--font-geist), monospace"
              >
                {edge.amount}
              </text>
            </g>
          );
        })}
        {nodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r="30"
              fill="#fff"
              stroke="#83593b"
              strokeWidth="1.5"
            />
            <text x={node.x} y={node.y + 6} textAnchor="middle" fontSize="22">
              {node.emoji}
            </text>
            <text
              x={node.x}
              y={node.y + 52}
              textAnchor="middle"
              fontSize="11"
              fill="#5c4a3c"
              fontFamily="var(--font-geist), monospace"
            >
              {node.id}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mx-auto mt-3 max-w-lg font-mono text-[11px] leading-relaxed text-slate-500">
        Example: <span className="font-medium text-ink-900">0.060 NEAR</span> in
        five bills becomes{" "}
        <span className="font-medium text-brand-700">0.019 NEAR</span> across
        three transfers —{" "}
        <span className="font-semibold text-brand-700">68.3% less volume</span>.
      </figcaption>
    </figure>
  );
}
