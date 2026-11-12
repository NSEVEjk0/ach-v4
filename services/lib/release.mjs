const requiredSuites=['rust-workspace','services','actual-wasm','client','intents','security-ui-proxy','core','agent-test-file'];
const requiredSources=['contracts/ach-v4/src/lib.rs','contracts/ach-v4/src/purchases.rs','services/agents/runtime.mjs','services/agents/planner.mjs','services/agents/main.mjs','services/lib/store.mjs','services/lib/workflow.mjs','services/lib/process.mjs','services/lib/paths.mjs','services/demo/sponsor.mjs','services/coordinator/coordinator.mjs','services/gateway.mjs','scripts/v4/browser.mjs','scripts/v4/build.mjs','scripts/v4/services.mjs','web/components/v4/AgentWorkspace.tsx','web/app/api/v4/[...path]/route.ts'];
export function requireCorrectionEvidence(review,manifest,currentHashes){
 const recordedSources=review.source_sha256;
 const valid=review.workflow_revision===2&&review.workflow_fixes_implemented===true&&review.live_attacks_executed===false&&Array.isArray(review.suites)&&review.suites.every(suite=>suite&&Number.isSafeInteger(suite.passed)&&suite.passed>0&&suite.failed===0&&suite.exit_code===0)&&requiredSuites.every(name=>review.suites.filter(suite=>suite.suite===name).length===1)&&review.suites.reduce((sum,suite)=>sum+suite.passed,0)===review.automated_tests_passed&&recordedSources&&requiredSources.every(filename=>Object.hasOwn(recordedSources,filename))&&Object.entries(recordedSources).every(([filename,hash])=>/^[a-f\d]{64}$/.test(hash)&&hash===currentHashes[filename])&&review.artifacts?.some(artifact=>artifact.name==='vault'&&artifact.sha256===manifest.artifacts.vault.sha256);
 if(!valid)throw new Error('CURRENT_CORRECTED_WORKFLOW_EVIDENCE_REQUIRED');
 return review;
}
export function requireCorrectedBrowserEvidence(report,{hostedJourney=false}={}){
 const required=['live-third-identical-brief','live-fresh-workspace-work-and-clearing','live-workspace-switch-preserves-history-and-private-results'];
 const valid=report?.passed===true&&(report.workflow_findings===undefined||Array.isArray(report.workflow_findings)&&report.workflow_findings.length===0)&&(!hostedJourney||Array.isArray(report.checks)&&required.every(name=>report.checks.some(check=>check?.name===name)));
 if(!valid)throw new Error('CURRENT_CORRECTED_BROWSER_EVIDENCE_REQUIRED');
 return report;
}
