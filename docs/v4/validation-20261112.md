# ACH verification continuation — 12 November 2026

The resumed checks verify workflow revision 2. **256 automated tests pass**, and three separate local browser passes each complete **66 checks**. The production web build, exact contract and worker artifacts, private cross-language integration and isolated downloadable SDK installation also pass.

| Suite | Passed |
| --- | ---: |
| Rust workspace | 46 |
| Actual vault/token Wasm | 4 |
| Services and private commerce | 53 |
| Client SDK | 24 |
| Owner Intents SDK | 15 |
| UI helpers, proxy, security and browser-checkpoint regressions | 32 |
| Core netting | 10 |
| Agent behavior | 14 |
| Legacy integration and dependency protections | 58 |
| **Total** | **256** |

The browser journeys cover desktop and mobile layouts, exact funded groups, zero available cash after reservation, repeat and identical briefs, independent fresh workspaces, reopening original History and private results, and session isolation. These local passes use actual vault/token Wasm and the native private worker; hosted testnet acceptance is recorded separately below.

A further local browser run after the session-recovery changes passes all 66 checks, including History pagination, owner-transfer exports, stale-state controls, repeated work and private-result reopening.

## RPC confirmation recovery

The live browser run exposed pending RPC confirmations being counted as service failures, and one unavailable workspace interrupting the coordinator's background pass. Pending RPC, transaction and service responses now resume the same durable request within its existing deadline. Service errors and expired requests retain their bounds, and unavailable workspaces no longer prevent later workspaces from settling or refunding expired reservations.

The recovery regressions exercise the actual vault/token Wasm. Repeated lost responses produce one inference, one funded group and three invoices, reserving the same 0.020 tUSDC net debit. Historical failed RPC requests recover without clearing their failure records. A failing earlier workspace cannot block another workspace's settlement or refund.

When providers have already committed the complete payment group, the coordinator recovers its original deliverable even after the UI deadline. Public work retains the same artifact and settles once. Private work returns the original encrypted response after a restart without another inference, private-worker charge, invoice or payment group. Incomplete groups retain their original expiry and refund rules. Reopening a workspace checks durable session ownership without reading financial RPC state, and service outages retain its existing cookie. All 53 service tests and all 26 security, UI and proxy checks pass after these changes; unchanged suites retain their verified source and artifact hashes.

## Live artifact and scale verification

The corrected candidate uses `ach-vault-v4r2-e53eefae.testnet` and `ach-usdc-v4r2-e53eefae.testnet`. Its vault SHA-256 remains `23043959af2ceb9ed557def2f8a24aa27e54ae8949679c0e0727069440bf2ee3`; its pinned private worker remains `d88bf904db9899a5a9ea56bea1ba7e417a26058a53fca00210e5f20e1384e26a`.

Both live maximum-size rounds settle with 12 participants and 48 invoices each. Maximum measured operation gas is 119.720919394752 TGas in the first round and 116.268170770668 TGas in the second. The fixtures use maximum-length identifiers, zero net funding and accumulated invoice storage. Independent token custody and ledger claims reconcile.

The interrupted scale transactions had insufficient native gas prepayment. The fixture now gives each explicit signer an additional bounded 0.5 testnet NEAR, tracked durably and included in the 9.36 NEAR total account-funding cap. This changes test funding without changing clearing amounts or visitor sponsorship rules.

The live private-key bootstrap now succeeds with the exact pinned worker. Earlier jobs timed out before their results could be resolved on chain; the previously unsubmitted third operation was recovered after a bounded 0.25 testnet NEAR gas top-up.

## Startup and dependency checks

Systemd rejected quoted `WorkingDirectory` and `EnvironmentFile` paths in the candidate service unit. The generator now writes those path fields correctly and validates the complete unit with `systemd-analyze --user verify` before starting services or funding a publisher. The corrected candidate unit passes validation without warnings and its services are healthy. Historical services retain their separate unit and state.

All six tracked npm lockfiles received a current advisory scan, including development dependencies. The root application, core, client, agent and web graphs have zero reported findings. The legacy build/test toolchain reports 16 low-severity findings propagated from two upstream issues: `deepmerge` prototype poisoning and the JavaScript Elliptic fallback. Its version-checked postinstall hardening filters prototype keys and requires native secp256k1; direct attack regressions and the complete legacy suite pass. The upstream version-based audit findings remain visible. The Intents package has only the audited client peer and no separate lockfile.

## Quote previews and browser continuation

The web release retains verified Base ↔ NEAR USDC dry quote previews. Its configuration reports this availability while preserving the testnet settlement network and the unverified status of mainnet transfers. Two additional proxy regressions verify those boundaries and ensure that backend errors and quote responses remain intact.

The live browser continuation verifies the already completed original and fresh workspaces without repeating their purchases or owner transfers. Private History selects the actual work row and compares its downloaded SVG bytes and SHA-256 with the original result decrypted by the owning browser. The earlier failed browser reports remain preserved.

## Release status

Both `NSEVEjk0/ach` and `NSEVEjk0/ach-v4` are verified private. Production serves workflow revision 2 with completed live AI work, public/private clearing, withdrawals and independent token-backing checks. Its local live-browser continuation completes 64 checks, and the interface fixture review completes 36. The final preview, production and public smoke reports each pass 28 checks. The current hosted journey completes 52 checks, and final backing is independently verified after its money actions. The historical November 10 release evidence remains available separately.

An interrupted hosted verifier had saved its cookie and request without retaining the private browser key. The existing private round remained READY with all three approvals; permissionless settlement completed its original 0.020 tUSDC payment without another purchase or worker execution. The verifier now saves one atomic checkpoint containing the session cookie, exact requests and browser keys before forwarding work or owner transfers. Checkpoints reject substituted deployments, sessions and origins. Six regressions cover recovery, damaged state, credential redaction and transient read retries; the complete affected suite passes 32 tests.

The independent-agent guide now documents the vault sponsor's registration authorization and the agent's separate owner/trading signers. The refreshed client archive installs and imports in an isolated offline project. Its SHA-256 is `8fdf5677d77682168d0ffac1963c6e3aa9e6310489fabc99a97668e7c6bb98b4`. Contract, token and pinned private-worker binaries are unchanged.

## Final hosted acceptance

The final application is [ach-rosy.vercel.app](https://ach-rosy.vercel.app), production deployment `dpl_85SASdXVGa8RMDrvFHr5tVnuQPeT`. Its web source SHA-256 is `0069db98f1ecbabfee29e5ea22860e41cb2be6950c711332f050d91a0c8dc025`. Preview `dpl_PURTGdoGTGk3q66uT9iaq8NQBjf8` passed before production promotion. Both deployments retain the pinned revision-2 vault and private-worker identities.

The hosted acceptance run finished at **19:48:19 UTC on 12 November** with **52 passing checks**, zero runtime errors and no text-contrast findings. It resumed the owning browser's original public/private requests and reconciled the original withdrawal and redeposit. The private SVG download matched the original decrypted artifact bytes and SHA-256. Another identical brief settled, a newly provisioned workspace completed its first trade, and switching back reopened the original History and private result. Each complete three-invoice group moved exactly **0.020 tUSDC** against **0.280 tUSDC** of bills. No original private inference or recorded money transfer was repeated.

An initial final-preview attempt timed out waiting for confirmed wallet data. Subsequent preview and production snapshot reads returned READY, and the new preview retry passed all 28 checks. The failed report remains preserved alongside earlier attempts. The completed hosted journey uses the current browser-checkpoint verifier; the preceding fresh-session control run remains separate evidence.

The independent final check at **19:51:13 UTC** verified **11,960,000 base units (11.96 tUSDC)** in token custody, **11,960,000** in ledger balances and **zero pending withdrawals**, against the pinned live vault code hash. This check followed all hosted money actions. The temporary Vercel automation bypass was revoked before the final public smoke and hosted journey; its temporary browser environment and request headers were removed.

The reviewed [desktop landing page](screenshots/landing-1440.png) and [mobile wallet](screenshots/wallets-390.png) come from the current public smoke run. Their [capture manifest](screenshots/manifest.json) binds image hashes to the runtime and browser report. They contain no private work. Credentials, private invoices, prompts, browser keys, raw snapshots and request headers remain in the private deployment stores.

The [release record](release.json) combines current source, browser, backing, private-worker and gas evidence. The source and evidence are published to the private `ach-v4` repository. Final documentation updates change no contract, worker, service, client implementation or web application code; completed code verification is retained with that scope recorded.

Mainnet token transfers remain untested. These engineering checks establish their covered cases and do not constitute an independent security audit.
