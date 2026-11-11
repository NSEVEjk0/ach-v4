import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import type { Snapshot } from '../../lib/v4';
import { AgentAvatar, PanelHeading } from './Interface';

const roles: Record<string, string> = {
  research: 'Plans work and supplies references', visual: 'Creates charts and commissions checks', audit: 'Checks data and supporting sources',
};

export default function WorkForm({ data, brief, dataset, mode, budget, privacy, pending, running, stale, onBrief, onDataset, onMode, onBudget, onPrivacy, onRun }: {
  data: Snapshot; brief: string; dataset: string; mode: string; budget: string; privacy: 'public' | 'private';
  pending: string; running: boolean; stale: boolean;
  onBrief: (value: string) => void; onDataset: (value: string) => void; onMode: (value: string) => void;
  onBudget: (value: string) => void; onPrivacy: (value: 'public' | 'private') => void; onRun: () => void;
}) {
  const budgetTooLow = mode === 'report' && BigInt(budget) < 280000n;
  return (
    <section className="brief-surface work-surface">
      <PanelHeading title="Create a brief" description="Ask your agents to turn a small dataset into a useful deliverable."><span className="tag">{Math.max(0, 2 - data.jobs.length)} free brief{2 - data.jobs.length === 1 ? '' : 's'} left</span></PanelHeading>
      <div className="brief-grid">
        <form className="brief-form" onSubmit={event => { event.preventDefault(); onRun(); }}>
          <label htmlFor="brief">What would you like the agents to make?</label>
          <textarea id="brief" maxLength={800} value={brief} onChange={event => onBrief(event.target.value)} aria-describedby="brief-hint" />
          <p id="brief-hint" className="form-hint">Describe the chart or report you need. Research Desk will plan the work.</p>
          <label htmlFor="dataset">Data for the chart</label>
          <textarea id="dataset" className="dataset-input" maxLength={2000} value={dataset} onChange={event => onDataset(event.target.value)} aria-describedby="dataset-hint" spellCheck={false} />
          <p id="dataset-hint" className="form-hint">Enter 1–12 rows as <code>label, value</code>. The example data can be replaced with your own values.</p>
          <div className="brief-options">
            <label>Deliverable<select value={mode} onChange={event => onMode(event.target.value)}><option value="report">Chart, references &amp; data checks</option><option value="chart">Chart only</option><option value="auto">Let Research Desk choose</option></select></label>
            <label>Budget in test money<select value={budget} onChange={event => onBudget(event.target.value)}><option value="300000">0.30 tUSDC</option><option value="100000">0.10 tUSDC</option></select></label>
          </div>
          {budgetTooLow && <p className="inline-error">The full report needs a 0.30 tUSDC budget. Choose that budget or a chart-only deliverable.</p>}
          <fieldset className="visibility-options"><legend>Who can read the invoice details?</legend><label><input type="radio" name="privacy" checked={privacy === 'public'} onChange={() => onPrivacy('public')} /><span><strong>Public</strong><small>Amounts visible on the ledger</small></span></label><label><input type="radio" name="privacy" checked={privacy === 'private'} disabled={!data.privacy.enabled} onChange={() => onPrivacy('private')} /><span><strong>Private invoices</strong><small>Encrypted invoice contents</small></span></label></fieldset>
          <p className="form-hint privacy-hint">{privacy === 'private' ? <><LockKeyhole size={14} />Providers see their own work. Invoice contents and deliverables are encrypted; participating agents and their net payments remain public. Keep using this browser to open the results.</> : 'Both parties accept the price. Public invoice details can be read on the ledger.'}</p>
          <div className="brief-submit"><span>Sponsored demo.<br /><strong>No real money is spent.</strong></span><button className="button primary" type="submit" disabled={Boolean(pending) || running || brief.trim().length < 8 || stale || data.jobs.length >= 2 || budgetTooLow}>{pending === 'run' ? 'Submitting brief…' : running ? 'Agents are working…' : 'Run agents'}<ArrowRight size={17} /></button></div>
        </form>
        <aside className="brief-aside" aria-label="Agents completing this brief"><span className="section-kicker">Your working group</span><h3>Three agents.<br />A complete piece of work.</h3>
          {data.session.participants.map(participant => <div className="agent-directory-row" key={participant.account_id}><AgentAvatar participant={participant} /><div><strong>{participant.name}</strong><span>{roles[participant.kind] ?? 'Independent agent'}</span></div></div>)}
          <div className="work-plan-note"><Sparkles size={16} /><p>Research Desk plans purchases with a model. Each service agent checks its orders and signs its own bills.</p></div>
          <details className="service-price-details"><summary>Service prices in test money</summary><div className="service-prices"><span>Chart generation<strong>0.10 tUSDC</strong></span><span>Data &amp; source checks<strong>0.10 tUSDC</strong></span><span>Reference packet<strong>0.08 tUSDC</strong></span></div></details>
        </aside>
      </div>
    </section>
  );
}
