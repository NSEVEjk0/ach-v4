# ACH v4 release and operations

The public application is [ach-rosy.vercel.app](https://ach-rosy.vercel.app). The current [deployment manifest](deployment.json) records the vault, settlement token, worker build, access keys, source fingerprint, limits, and transaction receipts. [Release evidence](release.json) records browser verification and an independent token-backing check. [Live service evidence](live.json) and [maximum-round measurements](gas.json) distinguish actual service work from financial fixtures.

The free deployment uses hosted test identities and a test token with no monetary value. A full-access vault key remains. Native NEAR operating costs come from the sponsor; settlement-token claims remain separately backed. Mainnet Intents transfers have not been exercised.

## Durable deployment state

Live scripts require the existing deployment namespace:

```sh
npm run test:live -- --private-root .local/v4-release-20261110 --verify-only
npm run test:e2e -- --private-root .local/v4-release-20261110 \
  --url https://ach-rosy.vercel.app --reuse-live --smoke \
  --output .local/v4-release-20261110/browser-operator-check
```

The namespace contains its authoritative `deployment.json`, private identities, `services.env`, transaction journals, and SQLite stores. Preserve these files across restarts. The copy under `docs/v4` is public release evidence, not a credential bundle.

The supervised service is `ach-v4.service` under the user's systemd manager. A controlled restart and backing verification use:

```sh
npm run test:live -- --private-root .local/v4-release-20261110 \
  --restart-services --verify-only
```

Do not reset the store to recover a pending operation. Reconcile its recorded transaction and chain state before retrying. Provisioning, private receipt verification, clearing, and owner withdrawals retain their operation identifiers. A failed top-level job can leave accepted subcontract bills; inspect those bills and their payment records before retrying.

The web server resolves a signed HTTPS gateway record pinned to this network and vault. The gateway publisher refreshes the record when its tunnel changes. The service token stays in server runtime configuration; it is never part of the browser bundle.

## Evidence and release

`scripts/v4/web-api.mjs` prepares private request files for Vercel's REST API. Use the existing ACH project, retain rollback metadata, verify a preview before production, and revoke any temporary automation bypass after browser checks. Never print credential headers, environment request bodies, or unredacted project responses.

`scripts/v4/finalize.mjs` verifies current browser reports, runtime identity, source artifacts, domain assignment, and final token backing before exporting public evidence. It includes every `web/lib` file in the source fingerprint and keeps the earlier deployment fingerprint. Private browser keys, invoices, prompts, and credentials stay in the private namespace. Failed reports remain available for review.

The interface release stores its deployment requests and hosted browser reports under `web-redesign-release`, preserving the earlier release. Finalize that release with `--release-directory web-redesign-release`. Its backing check must follow the final hosted money actions, and its reports include text-contrast checks. The finalizer exports browser `workflow_findings` and a sanitized fresh-session observation, without publishing the browser session credentials or private snapshot. The [workflow review](workflow-audit.md) records the current implementation’s flaws and proposed corrections; those financial and coordinator fixes are deliberately unimplemented.

The current hosted real-session journey passed 43 financial and interface checks while recording W06: the public three-bill group settled in two rounds moving 0.200 tUSDC rather than one 0.020 round. Its wallet setup took 187,848 ms in that one session. The isolated workflow suite passed 18 checks and reproduced W09, selective collection of an incoming bill followed by owner withdrawal while the debtor's accepted outgoing bill stayed unpaid. Passing checks do not remove these findings.

The Rust vault settles at most 12 participants and 48 public invoices in one round. The maximum-state live measurements are financial fixtures and do not count as service purchases. Private rounds permit six invoice receipts. A READY round remains enforceable after its authorization deadline; incomplete proposals have bounded expiry and reservation-release paths.

## Limits of the demonstration

Providers can decline deferred payment or require a funded single-invoice round before service. ACH does not adjudicate arbitrary AI output quality or guarantee payment from an unwilling, unfunded participant. Excluded bills remain outstanding.

Gross private invoice contents are encrypted before leaving their service party. Identities, timing, net movements, and external transfers remain public. OutLayer receipt verification does not itself authorize a debit; every included party still approves its exact netting result.

Intents route quotes are live mainnet previews. Owner routing and destination verification have automated coverage, but no mainnet transfer evidence is claimed. Real execution needs separate funding, deployment, and owner source signers.
