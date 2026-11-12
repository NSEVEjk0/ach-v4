# ACH v4 local security review — 11 November 2026

The corrections close the reproduced pre-delivery payment and selective-collection windows for new workflow-revision-2 orders. Participants authorize an exact purchase group before execution; its net debtors reserve cash, useful artifacts require its complete READY or SETTLED commitment, and its receipts settle together. An incomplete group expires and returns its reservations and unused allowance while retaining replay tombstones.

**169 automated tests passed.** The review also verified the contract/worker and SDK builds, the production web build, and installation of the downloadable SDKs outside the repository. The isolated SDK importer writes its own evidence and confirms that both modules resolve inside the fresh installation. Fresh browser execution, the legacy integration suite and a current dependency vulnerability-feed result remain incomplete, as detailed below. Passing these tests establishes the covered cases; it does not establish the absence of every vulnerability.

The work is local to `/root/ach-v4`, branch `fix/workflow-commitments`, against published baseline `07c55490c8676efc1c59677d9dbc494d1e389847`. No changes were committed, pushed or deployed. No live transactions, inference requests, account provisioning or service restarts were performed. The hosted November 10 release at [ach-rosy.vercel.app](https://ach-rosy.vercel.app) and its historical records remain unchanged. The [baseline workflow review](workflow-audit.md) documents that release's flaws; its report-only tests are excluded from acceptance results for the corrections.

## Corrected workflow findings

The [correction record](workflow-fixes.md) maps W01–W09 individually. Their principal enforcement paths are [the vault purchase implementation](../../contracts/ach-v4/src/purchases.rs), [service execution](../../services/agents/runtime.mjs) and [the coordinator](../../services/coordinator/coordinator.mjs).

| Findings | Corrected behavior | Regression evidence |
| --- | --- | --- |
| W01, W02, W09 | Reserve only the agreed net debits before execution; bind all purchases, outputs and receipt settlement to the exact group; withhold useful output until the whole group is payable. | Reserved cash cannot be withdrawn; an incoming leg cannot clear separately; missing delivery withholds output and expires; lost funding and final-work responses recover the original group. |
| W03 | Require buyer-funded orders before invoice creation; bind purchase IDs and canonical invoice IDs, with a proposer namespace for groups. | Foreign sellers cannot occupy a purchase; altered terms, foreign invoice IDs and future-dated receipts fail transactionally. |
| W04 | Admit registered sponsored identities only; cap persistent visitor records at 128 and coordinator records at 4,096; reserve storage for terminal states. | Direct registration and quota attacks fail; subsequent valid delivery, expiry, settlement and recovery still work after active capacity or native headroom is exhausted. |
| W05 | Search bounded feasible components and cycles within public/private group limits. | An unfunded intermediate cycle is found; oversized candidate groups are skipped; unrelated feasible business proceeds. |
| W06 | Persist manual scheduling and protect active request scope; funded groups remain indivisible. | Restart retains the policy; partial collection fails; expired UI requests reconcile existing READY/SETTLED states without sponsoring replacements. |
| W07 | Bind private orders to group deadlines and refund unused allowance on incomplete-group expiry. | Finalized private receipts in an incomplete group expire without double refunds; late work cannot recreate expired purchases. |
| W08 | Record owner operation receipts and background settlements; combine available contract/session activity with stable pagination and explicit transfer states. | History includes the newest events beyond the first 100; cursors and session scope remain stable; token refunds are never reported as credited deposits. |

Public purchase-group approvals independently bind exact terms and positions. Private groups require the exact member/order set, both-party invoice signatures, and the pinned worker's matching net result. Public rounds permit 12 participants and 48 orders; private rounds retain their six-receipt limit. A READY commitment survives later authority revocation and deadline expiry.

The new maximum-size regression creates 48 orders among 12 participants with several debtors and creditors. Its independent bilateral accounting model checks the group's positions and every wallet reservation. One debtor starts a unit short: its approval fails without changing state, then succeeds after the missing unit arrives. Reversed approvals and deliveries, repeated approvals, owner withdrawal attempts and partial settlement attempts are exercised. The complete round settles once with only net-debtor cash and zero spare native storage headroom, producing the independently expected balances and gross allowance usage. This is an offline financial/storage check, not a measured NEAR gas or capacity result.

A separate actual-Wasm scale test found that valid maximum-length fields in a 48-order group exceeded the former 32,768-byte input limit. The vault now permits 64,000 bytes specifically for `propose_purchase_group`; other methods retain 32,768 bytes. Register length is checked before input allocation. The regression rejects oversized input, then completes two 48-order/12-participant groups using maximum group, purchase and service identifiers, canonical 69-byte invoice IDs, large integer amounts and zero net funding. Its 96 accumulated receipts retain independent token backing. Live gas measurements for these corrected artifacts remain outstanding.

## Additional findings and hardening

| Area | Change and evidence |
| --- | --- |
| Terminal storage | `Transaction::reserve_for` and dedicated funding-group, round and invoice saves reserve their terminal footprints. `RECOVERY_STORAGE_CAPACITY_REQUIRED` remains enforced. Public/private expiry, settlement and recovery checks cover zero native headroom. |
| Deposit replay | `deposit:<id>` callbacks retain amount-bound receipt tombstones. Duplicate callbacks return the transferred amount for refund and cannot create a second credit. Sponsor receipts distinguish a confirmed token refund from an accepted vault deposit. |
| Signer concurrency and recovery | SDK transports and durable action batches share signer locks in one process. Journals bind the signer, operation payload and original signed bytes. Read-only reconciliation never broadcasts, and `NONE` status reads require explicit FINAL execution before claiming success or final failure. |
| Deployment verification | Writes recheck the vault identity, revision and configured code hash. A pinned code hash with a custom transport that cannot read the code hash fails closed. |
| Intents routing | Approval and status reconciliation bind the complete quote, request modes, correlation ID, contracts, deposit address/memo, amounts and deadlines. Per-route locks cover execution, refresh and deposit. Payout withdrawals bind owner, receiver and amount. Expiry is rechecked after withdrawal; an expired unknown source transfer uses read-only recovery of the recorded operation. Funding deposits cap at the route's quoted output. Independent receipt checks reject substituted token contracts, transaction hashes and explicitly non-final NEAR results. Failed routes cannot become paid; subsequent refunds remain observable. |
| Request boundaries | The web proxy and services bound incoming JSON before full buffering and reject invalid UTF-8. The proxy also bounds downstream JSON. Exact secrets, same-origin write checks, session/payload binding, validated sponsorship identity headers and redirect rejection have direct regressions. Signed gateway discovery binds destination, network, vault and expiry; cache lifetime follows the signed expiry. |
| Clearing interface | The actual UI helper credits reservations only for the complete READY group's exact membership, positions and approvals. It accepts zero available cash when that group already owns its reservation, keeps separate groups separate, and disables actions for incomplete financial data. Private selections use charge IDs and preserve the six-receipt limit. |
| Artifact handling | Generated artifacts bind the funded order's expected output hash. SVG validation restricts elements and attributes, rejects active content and external resources, and preserves supported chart geometry. Useful service artifacts remain gated on the complete group's READY/SETTLED state. |
| AI planner | The fixed NEAR AI endpoint rejects redirects. Response reading stops at 20,000 bytes, cancels oversized streams and rejects malformed UTF-8 before parsing. Valid streamed text retains its response hash and usage evidence; malformed bounded plans still get one correction. Private briefs and labels stay redacted from planner requests. SQLite consumes each attempt before transport starts and permits at most two attempts per job across connections and restarts. Nine mocked planner tests cover these rules without credentials or live inference. |
| Canonical hashes | Funding-group ordering uses the byte order shared with Rust. Locale sorting previously rejected valid mixed-punctuation account IDs. The actual-Wasm regression covers `aa-1.testnet`, `aa.1.testnet` and `aa_1.testnet`, reversed inputs and successful authorization. The reproduced pre-fix `PURCHASE_GROUP_MEMBER_MISMATCH` log is retained locally. |
| Repeat judging | The coordinator and UI remove the two-brief count. Brief admissions retain one active job, a five-second interval and a shared daily planner budget. Fresh workspaces have independent Wasm wallets; reopening the original active workspace preserves its settled records and encrypted results. Session switching requires the same ownership family and rotates a bounded alias token. Stale UI responses cannot authorize wallet actions or restore private results from the previous workspace. Sessions remain active for 24 hours. |
| Operations guards | Provisioning, deployment and service-start scripts require workflow revision 2 and fresh matching `ach-v4r2-demo-<8 hex>.testnet`, `ach-vault-v4r2-<8 hex>.testnet` and `ach-usdc-v4r2-<8 hex>.testnet` names. Namespace-derived units and ports preserve the historical service. Startup checks the exact unit/PID and available ports before publisher funding. Saved root, coordinator, publisher and visitor identities must match; visitor IDs are derived from the selected root and session before owner signing or sponsorship. A saved environment cannot redirect children to another store or manifest. Guard regressions reject substituted identities and environments. No deployment or live service-start script was executed. |
| Verification processes | A subprocess can return status zero alongside a permission error in this environment. Build, test and service wrappers now reject execution errors. The isolated SDK check awaits each process and requires evidence written by the actual importer, including its resolved module paths and verification-script hash. Missing import evidence cannot become a passing SDK report. A revision-2 release also rejects browser reports with workflow findings and requires hosted repeat-brief, fresh-workspace and original private-History checks. These hosted journeys are prepared and remain unverified. |
| Private negative fixture | Live negative checks now prepare an approved funded single-order group before attempting tampered or timed-out private work. Expiry waits for the final block timestamp and checks both cash and allowance refunds. The actual vault/token Wasm and native worker regression passes; no live OutLayer request was made. |

## Validation results

Counts below include each completed test once. Repeated verification runs and the separate private scenario program are not added to the total. The Rust workspace includes retained historical settlement-state invariants and 16 fresh revision-2 workflow tests.

| Suite | Command | Passed |
| --- | --- | ---: |
| Rust workspace | `cargo test --locked --offline --workspace` | 46 |
| Services and private commerce | `npm run test:services` | 46 |
| Actual vault/token Wasm | `npm run test:wasm` | 4 |
| Client SDK | `npm test --prefix packages/client` | 24 |
| Owner Intents SDK | `npm test --prefix packages/intents` | 15 |
| UI helpers, direct proxy handlers and security regressions | `npm run test:security` | 23 |
| Core netting | `npm test --prefix packages/core -- --maxWorkers=1 --minWorkers=1` | 10 |
| Agent Node test file | `npm test --prefix agent` | 1 |
| **Total** | | **169** |

Additional checks passed:

- `node scripts/v4/private-test.mjs`: TypeScript encryption and real signatures consumed by the native Rust private worker, with fixed ciphertext size, unauthorized-disclosure, tamper and expiry rejection, and no plaintext gross data in its output.
- `node scripts/v4/build.mjs --offline`: vault, test-token, WASI worker and both SDK builds. Core distribution output was rebuilt from its existing source, and the legacy clearing contract build passed.
- `npm run build --prefix web`: production compilation, lint and type checks with Node 22.23.3 and Next 15.5.28.
- `node scripts/v4/browser.mjs --sdk-only --offline`: a fresh installation of both downloadable archives outside the repository verifies their funded-purchase helpers and read-only recovery exports. The actual importer writes a private evidence file; module resolution, both process exit codes and the verification-script hash are retained.
- JavaScript syntax checks, local report-link checks, artifact hash verification, historical-report preservation and `git diff --check`.

Rust verification used the direct 1.90.0 toolchain binaries and the existing offline cache. In this environment, the reproducible command prefix is:

```sh
env PATH=/root/.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  CARGO_HOME=/root/splitpot/node_modules/.cache/sealwork-cargo-20261030 \
  RUSTC=/root/.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin/rustc \
  RUSTDOC=/root/.rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin/rustdoc \
  cargo test --locked --offline --workspace
```

Full logs and a hash/count/source verification manifest are retained in the ignored local directory `.local/security-review-20261111/evidence/`. The earlier 149-test checkpoint is preserved separately. Starting changes and pre-fix/failure evidence remain under `/tmp/ach-v4-audit-20261111` and `/tmp/ach-v4-retest-20261111`. These local logs are not public release evidence.

## Artifact identity

The local [build manifest](build.json) identifies workflow revision 2. Its SHA-256 hashes were checked against the files on disk:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Vault Wasm | 1,003,092 | `23043959af2ceb9ed557def2f8a24aa27e54ae8949679c0e0727069440bf2ee3` |
| Test-token Wasm | 244,607 | `5864be3d2a4a14c743952d0d23f12d77e53a801e23bfdd6f0216b6012f258e31` |
| WASI private worker | 375,649 | `d88bf904db9899a5a9ea56bea1ba7e417a26058a53fca00210e5f20e1384e26a` |
| Client SDK archive | 20,568 | `534f130d9017f8b2198ebb99b21bffe0f421c965a99ab269cc9d88d559c40c59` |
| Intents SDK archive | 9,698 | `d7905562e499ee4aef9e95d22bd008bbc38455465a4f4c24146d977634b837f2` |

## Unverified paths and remaining boundaries

**Fresh desktop/mobile browser execution did not pass in this environment.** The latest default-sandbox `npm run test:e2e -- --local` attempt stopped at `listen EPERM` with zero completed journey checks. An earlier Chromium startup also failed with a sandbox `Operation not permitted` error. Automatic approval review rejected running that browser command outside the sandbox because `sandbox_approval` is disabled. No escalation workaround was attempted. The prepared local harness uses isolated stores, generated identities, actual vault/token Wasm and the native private worker; it was statically reviewed and syntax-checked, but its repeat-brief, workspace-switch, money-action and private-decryption journeys and screenshots remain unverified. Direct request-handler and UI-helper tests plus a production web build passed; they do not replace browser verification.

**The legacy clearing integration suite did not complete.** Its test fixture compiled. Earlier setup heap exhaustion was traced to `node-port-check.nextAvailable()` recursively treating denied binds as occupied ports. A listener preflight now stops immediately with `LEGACY_SANDBOX_LISTENER_UNAVAILABLE:EPERM`; zero of its 55 tests ran. Both the historical heap failure and the current preflight log are retained. This legacy contract is separate from the Rust v4 vault covered above.

**A current dependency vulnerability-feed result is unavailable.** `npm audit --omit=dev --json` failed with registry DNS `EAI_AGAIN`. An additional bulk advisory query covering 559 dependency names and 609 versions from six tracked lockfiles, including development dependencies, also failed DNS resolution. Installed versions and builds were checked, but no clean current advisory scan is claimed.

Mainnet routing, newly deployed revision-2 NEAR gas/capacity, live OutLayer execution of the corrected flow and new hosted user journeys were not exercised. Historical browser, backing and gas records describe the unchanged release. They cannot validate the new code.

Hosted owners and the vault upgrade authority remain part of the existing demo's custody model. Client code pins detect changes before client operations; they cannot remove operator upgrade powers. Private processing protects stored/in-transit invoice contents but exposes plaintext to service processes and leaves identities, timing and net movements public. The service-specific acceptance checks do not adjudicate arbitrary AI quality or insure computation already spent on a group that expires incomplete.

SDK signer locks and route-store locks serialize work within one process. Other processes require distinct keys or exclusive writer coordination, as documented in the SDK guides. Bounded coordinator selection does not promise globally optimal netting. This was a local engineering review, not an independent security audit or a production-readiness certification.

## Publication preparation

The validation results above were captured before preparing a release commit. The source and existing README wording are ready for publication, with the latest test note added. GitHub publishing credentials are currently unavailable in this session. The ACH Vercel project is accessible, and its production runtime still uses the historical vault. A corrected site release requires fresh contract/services and current live/browser evidence. Publication metadata now requires a verified matching GitHub commit and source fingerprint instead of assuming the earlier unpublished state.
