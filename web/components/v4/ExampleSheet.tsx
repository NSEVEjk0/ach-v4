'use client';

import { useState } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronRight } from 'lucide-react';

const fullBills = [['A', 'B', 100], ['B', 'C', 100], ['C', 'A', 80]] as const;

export default function ExampleSheet() {
  const [net, setNet] = useState(false);
  const [group, setGroup] = useState<'all' | 'pair'>('all');
  const all = group === 'all';
  const bills = all ? fullBills : fullBills.slice(0, 1);
  const positions = all ? [['A', -20], ['B', 0], ['C', 20]] as const : [['A', -100], ['B', 100]] as const;

  return (
    <figure className="netting-example" aria-labelledby="example-caption">
      <figcaption id="example-caption">
        <span className="example-label"><span className="status-dot" /> A network of agreed payments</span>
        <span className="example-badge">Illustration</span>
      </figcaption>
      <div className="example-graph" aria-hidden="true">
        <svg viewBox="0 0 500 245" fill="none">
          <defs><marker id="flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="currentColor" /></marker></defs>
          <path className={`graph-line ${net ? 'muted-line' : ''}`} d="M139 83C198 35 284 35 353 83" markerEnd="url(#flow-arrow)" />
          <path className={`graph-line ${!all || net ? 'muted-line' : ''}`} d="M369 121C378 172 330 207 275 208" markerEnd="url(#flow-arrow)" />
          <path className={`graph-line ${!all || net ? 'muted-line' : ''}`} d="M226 209C167 207 113 169 115 121" markerEnd="url(#flow-arrow)" />
          {net && <path className="graph-line settled-line" d={all ? 'M139 123L231 183' : 'M143 105H347'} markerEnd="url(#flow-arrow)" />}
          {!net && <><text x="246" y="45" className="graph-amount">100</text><text x="385" y="188" className={!all ? 'graph-amount muted-text' : 'graph-amount'}>100</text><text x="108" y="188" className={!all ? 'graph-amount muted-text' : 'graph-amount'}>80</text></>}
          {net && <text x={all ? '174' : '246'} y={all ? '164' : '92'} className="graph-amount">{all ? '20' : '100'}</text>}
          <circle cx="117" cy="103" r="27" className="graph-agent agent-a" /><text x="117" y="110" className="graph-letter">A</text>
          <circle cx="375" cy="103" r="27" className="graph-agent agent-b" /><text x="375" y="110" className="graph-letter">B</text>
          <circle cx="250" cy="209" r="27" className={`graph-agent agent-c ${!all ? 'muted-node' : ''}`} /><text x="250" y="216" className="graph-letter">C</text>
        </svg>
        <span className="graph-center-label">{net ? 'Final payments' : 'Agreed bills'}</span>
      </div>
      <div className="example-controls">
        <div className="segmented-control" role="group" aria-label="Example clearing group">
          <button aria-pressed={all} onClick={() => setGroup('all')}>All three agents</button>
          <button aria-pressed={!all} onClick={() => setGroup('pair')}>A and B only</button>
        </div>
        <button className="example-toggle" onClick={() => setNet(value => !value)} aria-label={net ? 'Show agreed payments' : 'Show net payments'}>{net ? 'View bills' : 'See the netting'}<ChevronRight size={16} /></button>
      </div>
      <div className="example-ledger" aria-live="polite" aria-atomic="true">
        <div className="example-ledger-heading"><span>{net ? 'Each agent’s final movement' : 'Who owes whom'}</span><span>USDC</span></div>
        {net ? positions.map(([agent, amount]) => (
          <div className="example-entry" key={agent}><span className={`example-initial initial-${agent.toLowerCase()}`}>{agent}</span><span>Agent {agent}<small>{amount < 0 ? 'Pays' : amount > 0 ? 'Receives' : 'Payments offset'}</small></span><strong>{amount < 0 ? '−' : amount > 0 ? '+' : ''}{Math.abs(amount).toFixed(2)}</strong></div>
        )) : bills.map(([buyer, seller, amount]) => (
          <div className="example-entry" key={buyer}><span className={`example-initial initial-${buyer.toLowerCase()}`}>{buyer}</span><span>Agent {buyer} <ArrowRight size={13} aria-label="owes" /> Agent {seller}</span><strong>{amount.toFixed(2)}</strong></div>
        ))}
      </div>
      <div className="example-funding">
        <div><span>Total bills</span><strong>{all ? '280' : '100'}<small> USDC</small></strong></div>
        <ArrowRight size={22} aria-hidden="true" />
        <div><span>Cash to clear them</span><strong className="example-net-amount">{all ? '20' : '100'}<small> USDC</small></strong></div>
        <span className="example-saving">{all ? <><ArrowDown size={13} />92.9% less payment volume</> : 'Full payment'} </span>
      </div>
      <p className="example-footnote"><Check size={14} aria-hidden="true" />{all ? 'Each agent approves its exact result. The round settles together.' : 'A and B can clear together. The other two bills remain outstanding.'}</p>
    </figure>
  );
}
