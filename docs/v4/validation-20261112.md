# ACH verification continuation — 12 November 2026

The resumed run completes the interrupted verification of workflow revision 2. **242 automated tests pass**, and two separate local browser passes each complete **66 checks**. The production web build, exact contract and worker artifacts, private cross-language integration and isolated downloadable SDK installation also pass.

| Suite | Passed |
| --- | ---: |
| Rust workspace | 46 |
| Actual vault/token Wasm | 4 |
| Services and private commerce | 48 |
| Client SDK | 24 |
| Owner Intents SDK | 15 |
| UI helpers, proxy and security regressions | 23 |
| Core netting | 10 |
| Agent behavior | 14 |
| Legacy integration and dependency protections | 58 |
| **Total** | **242** |

The browser journeys cover desktop and mobile layouts, exact funded groups, zero available cash after reservation, repeat and identical briefs, independent fresh workspaces, reopening original History and private results, and session isolation. These two passes use actual vault/token Wasm and the native private worker locally; they are separate from hosted testnet acceptance.

## Live artifact and scale verification

The corrected candidate uses `ach-vault-v4r2-e53eefae.testnet` and `ach-usdc-v4r2-e53eefae.testnet`. Its vault SHA-256 remains `23043959af2ceb9ed557def2f8a24aa27e54ae8949679c0e0727069440bf2ee3`; its pinned private worker remains `d88bf904db9899a5a9ea56bea1ba7e417a26058a53fca00210e5f20e1384e26a`.

Both live maximum-size rounds settle with 12 participants and 48 invoices each. Maximum measured operation gas is 119.720919394752 TGas in the first round and 116.268170770668 TGas in the second. The fixtures use maximum-length identifiers, zero net funding and accumulated invoice storage. Independent token custody and ledger claims reconcile.

The interrupted scale transactions had insufficient native gas prepayment. The fixture now gives each explicit signer an additional bounded 0.5 testnet NEAR, tracked durably and included in the 9.36 NEAR total account-funding cap. This changes test funding without changing clearing amounts or visitor sponsorship rules.

The live private-key bootstrap now succeeds with the exact pinned worker. Earlier jobs timed out before their results could be resolved on chain; the previously unsubmitted third operation was recovered after a bounded 0.25 testnet NEAR gas top-up.

## Startup and dependency checks

Systemd rejected quoted `WorkingDirectory` and `EnvironmentFile` paths in the candidate service unit. The generator now writes those path fields correctly and validates the complete unit with `systemd-analyze --user verify` before starting services or funding a publisher. The corrected candidate unit passes validation without warnings and its services are healthy. Historical services retain their separate unit and state.

All six tracked npm lockfiles received a current advisory scan, including development dependencies. The root application, core, client, agent and web graphs have zero reported findings. The legacy build/test toolchain reports 16 low-severity findings propagated from two upstream issues: `deepmerge` prototype poisoning and the JavaScript Elliptic fallback. Its version-checked postinstall hardening filters prototype keys and requires native secp256k1; direct attack regressions and the complete legacy suite pass. The upstream version-based audit findings remain visible. The Intents package has only the audited client peer and no separate lockfile.

## Release status

Both `NSEVEjk0/ach` and `NSEVEjk0/ach-v4` are verified private. Live AI work, public/private clearing, withdrawals and hosted acceptance are being completed before the previously authorized repository and site publication. The historical November 10 release evidence remains available while the candidate is verified.

Mainnet token transfers remain untested. These engineering checks establish their covered cases and do not constitute an independent security audit.
