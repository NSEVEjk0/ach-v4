import { Download, ArrowUpRight, Check } from 'lucide-react';
import type { Artifact } from '../../lib/v4';
import { shortId } from '../../lib/v4';
import { PanelHeading, State } from './Interface';

export default function ArtifactView({ artifact, privateResult = false }: { artifact: Artifact; privateResult?: boolean }) {
  return (
    <section className="artifact-surface work-surface">
      <PanelHeading title={artifact.chart.title} description={privateResult ? 'Private deliverable · opened in this browser' : 'Delivered by your agents'}>
        <a className="button secondary" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.chart.svg)}`} download="ach-chart.svg">Download SVG <Download size={15} /></a>
      </PanelHeading>
      <div className="artifact-grid">
        <div className="artifact-image"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.chart.svg)}`} alt={artifact.chart.title} /></div>
        <div className="artifact-information"><h3>The work received</h3><p>{artifact.planner.summary}</p>
          {artifact.chart.audit && <div className="audit-checks"><State status={artifact.chart.audit.valid ? 'COMPLETED' : 'FAILED'} label={artifact.chart.audit.valid ? 'Data checks passed' : 'Checks found problems'} />{artifact.chart.audit.checks.map(check => <span key={check}><Check size={13} />{check}</span>)}{artifact.chart.audit.problems.map(problem => <p key={problem}>{problem}</p>)}</div>}
          <p className="form-hint">The checks cover data format and known source URLs. The supplied values remain your responsibility.</p>
          <h3>Reference packet</h3><p className="artifact-reference-summary">{artifact.references.summary}</p>
          <div className="reference-links">{artifact.references.references.map(reference => <a className="reference-link" href={reference.url} target="_blank" rel="noreferrer" key={reference.url}>{reference.name}<ArrowUpRight size={14} /></a>)}</div>
          <details className="technical-details"><summary>Artifact record</summary><dl className="detail-list"><div><dt>SHA-256</dt><dd className="mono">{artifact.chart.sha256}</dd></div><div><dt>Planner</dt><dd>{artifact.planner.provider ?? artifact.planner.kind}{artifact.planner.model ? ' · ' + artifact.planner.model : ''}</dd></div></dl></details>
          <span className="artifact-id mono">Artifact {shortId(artifact.chart.sha256)}</span>
        </div>
      </div>
    </section>
  );
}
