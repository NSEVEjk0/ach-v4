# ACH v4 — release and independent review

Use this after implementing [the build plan](ACH_V4_BUILD_PLAN.md). No item is satisfied merely because an earlier v2/v3 test passed. Record the exact commit and artifacts for every run.

## 1. Evidence bundle

Create a private working bundle and a separately redacted, reproducible public evidence bundle. Include:

- Source commit, dirty-worktree status, lockfiles, toolchain versions, build commands and outputs.
- Contract/worker binary hashes, network, addresses, settlement token and decimals, pinned verifier reference, ABI and deployment transactions.
- Live account code hash and key/upgrade/owner permissions checked against the intended posture.
- Test outputs with failures retained and explained; no hand-edited success summaries.
- Public, private and external-route examples with request IDs, transaction hashes, balances before/after and exact completion states.
- Financial measurements and assumptions for both ACH and direct-payment baselines.
- Desktop/mobile screenshots and the actual browser journeys used.
- Operational restart/recovery results, sponsor runway and currently unresolved jobs/routes.
- An explicit list of live integrations, simulations, unavailable capabilities and remaining trust assumptions.

Do not include private keys, API tokens, environment files, user documents, plaintext private invoices or private model prompts. Inspect the bundle before publishing it.

## 2. Financial and authorization checks

| Scenario | Required observation |
|---|---|
| One-way funded bill | It settles when authorized even with zero compression. |
| Balanced cycle | All invoices settle with zero net funding; no withdrawable money is minted. |
| Net-funded three-party round | Only the net debtor supplies settlement cash; final balances and all invoice states match. |
| Participant excluded | Funding is recalculated; old approvals cannot authorize the new round; excluded claims remain intact. |
| Same cash committed twice | The second reservation is refused or requires additional available balance. |
| Withdrawal of committed money | Refused without disturbing existing reservations. |
| Two proposals share an invoice | At most one reaches READY/settles; stale temporary reservations can be recovered. |
| Two callers settle concurrently | One settlement effect; the other cannot pay again. |
| Changed amount, party, asset, expiry or invoice set | Old signatures/approvals fail. |
| Cross-contract/network replay | Refused by domain binding. |
| Timeout followed by retry | The existing operation is reconciled; no duplicate invoice or payment. |
| Same purchase rebilled under a new invoice ID or privacy mode | Refused by the canonical purchase/charge identifier. |
| Forged incoming receivable | No cash credit is created before backed settlement. |
| Fully committed member attempts cancellation | Cannot remove one leg or reclaim required funds. |
| Cancellation races final authorization | Either the proposal cancels safely before commitment or it commits/settles; never partial credits. |
| Incomplete proposal expires | Temporary funds are recoverable without the website/coordinator. |
| Unrelated new invoice arrives | Existing valid proposals do not become stale solely because a global counter changed. |
| Unauthorized policy or owner withdrawal | Trading keys cannot perform owner-only operations. |
| Many purchases net to a small debit | Gross purchase permission limits still apply across pending and settled charges. |
| Agent key revoked | New unauthorized commitments fail; already irrevocable rounds retain defined settlement rights. |
| Overflow, bad decimals, duplicate IDs, self-invoice | Rejected explicitly without inconsistent totals. |
| Equal net amounts / different input ordering | Canonical hashes and deterministic results match in Rust, TypeScript and the worker. |
| External token payout fails after initiation committed | Claim is restored exactly once; reservations and other balances remain correct. |
| Forged or repeated withdrawal callback | Cannot create credit or complete someone else's withdrawal. |

Use both targeted adversarial tests and a stateful independent reference model. Randomized deposit/approval/cancel/settle/withdraw sequences should check conservation, available balance and unique invoice consumption after every step. Inject meaningful faults to confirm the suite would detect double credit and premature release; do not rely on tests that merely repeat the production algorithm.

## 3. Scale, gas and storage

- Measure the maximum advertised participant/invoice/record-byte limits against a realistic accumulated history.
- Verify settlement remains within a conservative gas margin; report actual measured gas and environment.
- Verify an oversized proposal is rejected before trapping users' funds.
- Ensure reads paginate and state-changing paths do not scan the entire lifetime history.
- Confirm a blocked or underfunded group does not prevent independent funded groups from progressing.
- Exercise native sponsor/storage exhaustion: it must not consume settlement tokens or falsely report them withdrawn.
- Reserve enough operational capacity before accepting commitments; verify final settlement/expiry/payout recovery paths remain possible.
- Preserve pending claims and required tombstones during pruning. Cleanup cannot enable replay or erase an unpaid balance.

## 4. Real agent journey

- Start a new session through the hosted page with no preinstalled wallet and no fee payment.
- Confirm the session is isolated from other visitors and explicitly uses test funds.
- Run a real brief; inspect the delivered dataset/chart/report artifacts and their receipts.
- Verify the three agents use independent signers and the coordinator does not forge their consent.
- Register a fourth independent agent using only the documented SDK and its own signer.
- Exercise successful work, refused work, failed provider, unexpected output, capped budget and no useful netting opportunity.
- Verify no random memo/ambient activity creates financial obligations.
- Kill/restart the coordinator and one provider during work. Reconcile without duplicate calls/bills or falsely completed jobs.
- Ensure user-controlled text/artifacts cannot modify financial policy, change recipients, escape output isolation or expose secrets.

## 5. Private mode

- Execute a real OutLayer run with the pinned worker; verify its artifact hash, input/output binding and intended caller path.
- Confirm each party's encrypted contribution reaches the correct run and cannot be decrypted by the coordinator or another unauthorized caller.
- Verify exact-build and caller/predecessor restrictions, including a malicious relay-context attempt.
- Test invalid signatures, altered ciphertext, wrong asset, duplicate/nullifier reuse, omitted invoice party and mismatched output plan.
- Revalidate each participant's exact expected net credit/debit; a zero debit cap must not authorize losing an expected credit.
- Reject old/duplicate callbacks, wrong request IDs, changed worker references and timed-out requests.
- Check browser requests, databases, logs, worker output, public chain arguments and exported receipts for plaintext leakage.
- Exercise an OutLayer outage. No plaintext fallback; incomplete proposals recover, and existing available balances remain accessible.
- Confirm the UI explains what remains public. Public net movements must not be described as fully shielded settlement.

## 6. Intents integration

- Verify supported asset/network identities, decimals, recipients, refund identities, quote expiry and minimum outputs against current API data.
- Exercise each material route state, including incomplete deposit, timeout/unknown broadcast, failure and refund.
- A quote or source-chain deposit alone must not credit ACH or mark a destination payout complete.
- Ensure the vault credits only an authenticated settlement-token deposit with correct beneficiary attribution.
- Demonstrate, with authorized small funds, a real incoming route, ACH deposit/round, and outgoing route or clearly document which live leg remains unexercised.
- Reconcile at the destination chain. An upstream SUCCESS label is not a substitute for the amount/recipient check required by the flow.
- Restart during routing; confirm no duplicate source transfer, ACH withdrawal or payout.
- Confirm refund recovery returns ownership to the intended account and does not reopen already settled invoices.
- Make test fixtures/dry quotes/mainnet operations visually distinguishable. Never present a third-party sandbox as an official Intents testnet.

## 7. Economic evidence

- Use identical service work and agreed prices for the direct and ACH cases.
- Include direct-payment liquidity recycling and state the payment-ordering/indivisibility assumptions.
- Record gross invoice volume, net settlement volume, peak actual cash committed, latency and external operating costs separately.
- Include one-way and poorly offsetting examples. Do not select only the most favorable cycle.
- Confirm “free demo” means no visitor charge while sponsorship costs remain measured separately.
- Do not label greedy transfer pairing globally optimal or equate volume reduction with total cost reduction.

## 8. Browser and visual review

Read [the design brief](ACH_V4_DESIGN_BRIEF.md) and review the complete flow, not only the landing screenshot.

- Inspect desktop 1440×1000, tablet around 834px and mobile 390×844, plus a narrower mobile width.
- Run onboarding → brief → delivered artifact → invoice → round → settlement → available balance → withdrawal.
- Test incomplete consent, changed subgroup, insufficient funds, failed route, private-mode failure and stale chain data.
- Check all primary controls actually perform the described action; no dead links or decorative fake buttons.
- Check keyboard-only operation, labels, focus order, dialog/sheet focus return, contrast and reduced motion.
- Test long names, small token amounts, large balances, empty activity and maximum supported round size.
- Verify there is no global horizontal overflow, hidden primary action, clipped amount or layout jump on data load.
- Confirm proof links resolve to the displayed real transaction/artifact and no private record appears in another session.
- Inspect console/network errors, refresh/re-entry behavior and accidental mixing of v2 and v4 data.
- Confirm the visual result follows the new direction rather than the old UI with changed colors.

## 9. Deployment and operations

- Check the hosted runtime configuration against the deployment manifest and actual chain code/version.
- Verify every read, write, export and agent uses the same network, token and vault.
- Confirm current services are healthy after restart and state is durable.
- Exercise direct SDK settlement/reclaim/withdrawal with the hosted coordinator unavailable.
- Verify sponsor limits, quota behavior and session cleanup without deleting financial claims.
- Confirm the legacy operator cannot continue generating bills in the v4 environment.
- Preserve the rollback of frontend/service configuration and test that it cannot rewrite settled state.
- Run secret scanning before a public push. Confirm repository visibility and publication authority separately.

## 10. Independent reviewer handoff and release decision

The reviewer starts from the deployed URL, a clean checkout, the exact manifest and this checklist. Reproduce representative success and adversarial paths independently; do not simply accept the builder's report. Review the contract's custody/upgrade model and privacy boundary as carefully as the UI.

Record findings by user impact: unauthorized spend, unbacked credit, lost withdrawal, disclosure, broken core flow, incorrect economic claim, usability defect or cosmetic issue. Give a reproduction and a proposed correction for each material finding.

Unauthorized spending, double settlement, lost claims, misleading live/simulated status, material privacy leakage and failure of the main hosted journey block a release claim. Missing requested integrations remain incomplete work; they are not silently relabelled as finished.

After fixes, rerun the affected checks plus the required release suite, rebuild, redeploy and independently verify the new artifact hashes. Do not endlessly repeat unrelated tests after the required checks pass.

The final user report should state what shipped, the live URL, what was actually tested, the demonstrated financial result, and concrete remaining limitations. A plan, passing compilation or polished screenshot is not a completed ACH v4 deployment.
