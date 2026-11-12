# ACH v4 release and operations

The public application is [ach-rosy.vercel.app](https://ach-rosy.vercel.app). Its November 10 [deployment manifest](deployment.json) records the historical workflow-revision-1 vault, settlement token, worker build, access keys, source fingerprint, limits, and transaction receipts. [Release evidence](release.json) records that version's browser verification and an independent token-backing check. [Live service evidence](live.json) and [maximum-round measurements](gas.json) distinguish actual service work from financial fixtures.

The subsequent [workflow corrections](workflow-fixes.md) and [local validation report](security-review-20261111.md) describe revision 2 in this checkout. They have not been pushed or deployed. The build manifest is local build evidence; it does not replace the historical deployment, release, live or gas records. Updated provisioning and service-start scripts require revision 2 and fresh matching account names, and reject the historical namespace before funding or replacing code.

Revision 2 removes the two-brief allowance and supports repeat briefs plus fresh test workspaces. Settings reopens earlier active workspaces in the same ownership family during their 24-hour sessions. One brief runs at a time per workspace, with a five-second admission interval. The default shared budget reserves at most 2,000 planner calls per UTC day; each admitted brief gets at most two attempts across retries and restarts. Workspace creation has a ten-second interval and native sponsorship reserves 2 testnet NEAR per workspace within a 26 NEAR daily budget. Wallet, private-execution and persistent-storage budgets remain bounded.

The free deployment uses hosted test identities and a test token with no monetary value. A full-access vault key remains. Native NEAR operating costs come from the sponsor; settlement-token claims remain separately backed. Mainnet Intents transfers have not been exercised.

## Durable deployment state

Historical read-only checks use the existing deployment namespace and matching
release source. Preserve that namespace; use a separate one for revision 2:

```sh
npm run test:live -- --private-root .local/v4-release-20261110 --verify-only
npm run test:e2e -- --private-root .local/v4-release-20261110 \
  --url https://ach-rosy.vercel.app --reuse-live --smoke \
  --output .local/v4-release-20261110/browser-operator-check
```

The namespace contains its authoritative `deployment.json`, private identities, `services.env`, transaction journals, and SQLite stores. Preserve these files across restarts. The copy under `docs/v4` is public release evidence, not a credential bundle.

The historical supervised service is `ach-v4.service` under the user's systemd manager. Restart it only with source and artifacts matching its recorded release. The revised services cannot run against the old manifest, and this audit did not restart or replace that service.

Each revision-2 candidate uses its own `ach-v4r2-<8 hex>.service` unit and five namespace-derived loopback ports. Startup checks the exact unit, PID, working directory, private store and manifest, and stops only a verified candidate writer. Port conflicts and denied listener permission stop startup before publisher funding. Loaded root, coordinator, publisher and visitor identities must match the selected namespace; a saved environment cannot redirect child processes to another deployment. Existing stores and identities stay with their original deployment.

Do not reset the store to recover a pending operation. Reconcile its recorded transaction and chain state before retrying. Provisioning, private receipt verification, clearing, and owner withdrawals retain their operation identifiers. A failed top-level job can leave accepted subcontract bills; inspect those bills and their payment records before retrying.

The web server resolves a signed HTTPS gateway record pinned to this network and vault. The gateway publisher refreshes the record when its tunnel changes. The service token stays in server runtime configuration; it is never part of the browser bundle.

## Evidence and release

`scripts/v4/web-api.mjs` prepares private request files for Vercel's REST API. Use the existing ACH project, retain rollback metadata, verify a preview before production, and revoke any temporary automation bypass after browser checks. Never print credential headers, environment request bodies, or unredacted project responses.

`scripts/v4/finalize.mjs` verifies current browser reports, runtime identity, source artifacts, domain assignment, and final token backing before exporting public evidence. It includes every `web/lib` file in the source fingerprint and keeps the earlier deployment fingerprint. Private browser keys, invoices, prompts, and credentials stay in the private namespace. Failed reports remain available for review.

A revision-2 release also supplies the current local correction manifest through `--workflow-review`. The finalizer checks its completed suites, current source hashes and exact deployed vault artifact, and rejects historical flaw-reproduction evidence or browser reports with remaining workflow findings. Its hosted journey must prove a third identical brief, fresh-workspace trading, and reopening the original History and private results. Current public/private live work, private-worker verification, maximum-round gas measurements and a backing check after the hosted money actions are still required. The local correction manifest does not satisfy these live checks.

After source publication, pass the verified GitHub context through `--git-context` to deployment and finalization. Its publication record binds `NSEVEjk0/ach-v4`, the exact commit, the current source fingerprint and the verification time. Uncommitted or mismatched source is rejected. Runtime configuration and exported release records derive their publication status from that evidence.

The interface release stores its deployment requests and hosted browser reports under `web-redesign-release`, preserving the earlier release. Its backing check follows its hosted money actions, and its reports include text-contrast checks. The finalizer exports browser `workflow_findings` and a sanitized fresh-session observation, without publishing the browser session credentials or private snapshot. The [workflow review](workflow-audit.md) records reproduced flaws in that published baseline. Its financial and coordinator corrections are now implemented locally; the review remains historical evidence of the unchanged hosted version.

The current hosted real-session journey passed 43 financial and interface checks while recording W06: the public three-bill group settled in two rounds moving 0.200 tUSDC rather than one 0.020 round. Its wallet setup took 187,848 ms in that one session. The isolated workflow suite passed 18 checks and reproduced W09, selective collection of an incoming bill followed by owner withdrawal while the debtor's accepted outgoing bill stayed unpaid. Passing checks do not remove these findings.

The Rust vault settles at most 12 participants and 48 public invoices in one round. The maximum-state live measurements are financial fixtures and do not count as service purchases. Private rounds permit six invoice receipts. A READY round remains enforceable after its authorization deadline; incomplete proposals have bounded expiry and reservation-release paths.

## Limits of the demonstration

Revision 2 providers start against an exact FUNDED purchase group and release useful output only after its complete READY or SETTLED payment commitment. An incomplete group expires and returns its reservations and unused allowance. Providers can require a funded one-order group. ACH does not adjudicate arbitrary AI output quality or insure execution costs if other deliveries fail. Agents can choose a different order set before funding; a funded group clears as a whole.

Gross private invoice contents are encrypted before leaving their service party. Identities, timing, net movements, and external transfers remain public. OutLayer receipt verification does not itself authorize a debit; every included party still approves its exact netting result.

Intents route quotes are live mainnet previews. Owner routing and destination verification have automated coverage, but no mainnet transfer evidence is claimed. Real execution needs separate funding, deployment, and owner source signers.
## Verification continuation — 12 November 2026

The [latest validation record](validation-20261112.md) completes the interrupted automated and local browser reruns and records the corrected live candidate. The [November 10 archive](history/20261110/README.md) preserves the preceding deployment and release evidence.
