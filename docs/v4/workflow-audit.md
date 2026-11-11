# ACH v4 workflow review — 10 November 2026

**The committed settlement works in the tested cases. The main payment-exploit window is earlier: work and accepted invoices can exist before payment funds are irrevocably reserved.** The current implementation therefore provides stronger final settlement than pre-delivery payment assurance.

This is an engineering workflow review of the hackathon implementation. It is not an independent security audit. The adversarial cases ran in isolated stores against the existing compiled NEAR Wasm and service code. No attack was executed against the public deployment. No financial or coordinator fixes from this review have been implemented.

## Evidence and scope

The [report-only audit suite](../../tests/v4/workflow-audit.test.mjs) passed **18 tests**: 12 additional workflow cases and the six commerce regressions registered by its shared setup. It exercises the actual vault Wasm, test-token Wasm, SDK, service agents and coordinator. The private allowance case also initializes the existing private-worker integration in the offline harness.

```sh
node --test --test-concurrency=1 --experimental-test-isolation=none tests/v4/workflow-audit.test.mjs
```

Vault Wasm SHA-256:

```text
a101500fc8e5a0c4f482db20b237b5722f74e4f4461da244576cd0cf3e360b14
```

The live vault remains `ach-vault-v4-650fb521.testnet`, code hash `BqVoRKp6s86q1K6VEBj9KCnbVktYEGjMrA72utYVAyko`. Contract and service implementations were preserved during this review. The Wasm host is an offline ABI and financial harness; it does not establish measured NEAR gas, production throughput, legal enforceability or security against every attack.

The interface separately passed 36 browser checks covering navigation, history, drafts, round expansion, exact selection, private missing-data handling, stale-data write disabling, and desktop/tablet/mobile layouts. The fresh public real-session journey passed 43 financial and interface checks, while recording the lost full-group netting described under W06. These passing checks verify the actual rounds and balances; they do not establish that the coordinator selected the most efficient group. Hosted release verification is recorded in [the release evidence](release.json).

## Findings

| ID | Finding | Impact | Priority |
| --- | --- | --- | --- |
| W01 | Invoice acceptance does not reserve payment funds | A buyer can withdraw or refuse final round approval after receiving work | High for open trading |
| W02 | Providers incur subcontract obligations before the final buyer accepts | A dishonest buyer can receive work while an honest provider pays dependencies | High for open trading |
| W03 | An unapproved invoice occupies a buyer purchase ID | A seller knowing the ID can block the intended order without buyer consent | High availability risk |
| W04 | Unaccepted proposals consume shared sponsored storage | Direct on-chain callers can stop new business by exhausting sponsor headroom | High availability risk |
| W05 | Automatic clearing overlooks feasible multi-invoice subgroups | A valid funded cycle can wait indefinitely when the full set is underfunded | Medium automation risk |
| W06 | Manual exclusions do not persist against automatic clearing | Agents may clear excluded bills later and lose a better offsetting opportunity | Medium workflow risk |
| W07 | Pending private purchase cancellation requires both parties | A missing seller can leave purchase allowance consumed | Medium liveness risk |
| W08 | History omits owner transfer receipts and later session events | Owners cannot reconstruct all money actions from the app’s history | Medium observability risk |
| W09 | A selective debtor can collect credits while refusing its accepted debt | Honest agents pay smaller rounds; the debtor withdraws receipts and leaves its bill unpaid | High for open trading |

### W01 — an accepted bill is still an unsecured receivable

[Invoice acceptance](../../contracts/ach-v4/src/lib.rs) charges the buyer’s gross purchase allowance. It does not reserve a token amount. [Round authorization](../../contracts/ach-v4/src/lib.rs) reserves the net debit; that commitment becomes irrevocable when all included participants have approved and the round is READY.

Reproduction: create an accepted 0.100 tUSDC chart invoice, then have its owner withdraw the full unreserved 1.000 tUSDC balance. The token withdrawal completes. Clearing returns `WAITING / INSUFFICIENT_AVAILABLE_BALANCE`, the invoice remains ACCEPTED, and the provider receives no funds.

A delegated trading key cannot withdraw funds. The malicious owner can do so, and a malicious trading agent can simply decline the final round approval. A spending allowance establishes what a key may authorize; it is not escrow collateral or an automatic collection right.

**Proposed improvement:** define the payment commitment before the provider releases useful work. For a known closed group, bind its orders, delivery conditions and net funding in an irrevocable conditional commitment. For an open purchase, reserve its exposure until valid offsets are known, or explicitly grant a bounded credit line backed by margin or an underwriter. Payment assurance cannot rely on future receipts that have not been committed.

### W02 — the final buyer can leave the provider holding the subcontract costs

The [service workflow](../../services/agents/runtime.mjs) buys dependencies and returns the deliverable before the purchasing agent accepts the final invoice. This works for cooperative hosted actors but grants credit to the buyer at that point.

Reproduction: give Visual Studio 0.100 tUSDC of its own funds. Research commissions the full report, receives a valid chart, and refuses its final invoice. The Visual-to-Audit 0.100 bill and Audit-to-Research 0.080 bill are already accepted. After 31 seconds, the coordinator clears those two bills. Visual’s funds fall to zero; Audit receives 0.020; Research’s balance rises from 1.000 to 1.080. The final Research-to-Visual bill stays PROPOSED.

The buyer both obtained usable work and remained a paid reference supplier in the dependency chain. This is more consequential than a single unpaid invoice because it propagates the cost through honest agents.

**Proposed improvement:** make the order’s funding and delivery-release policy explicit before subcontracting. A provider should limit dependent purchases to secured customer commitments or its consciously approved credit exposure. Staged delivery, committed artifact access, objective acceptance rules and a bounded dispute/refund path can help. A cryptographic artifact hash alone cannot determine whether a service was satisfactory.

### W03 — a seller can poison a known purchase ID

`propose_invoice` writes the purchase charge record before the buyer accepts. The charge key binds the buyer, purchase ID and terms version. The proposer’s permission is checked; the buyer’s counterparty allowlist is enforced later at acceptance.

Reproduction: restrict Research to buying from Visual. Audit proposes a one-unit bill using Research’s known intended purchase ID. Research has never approved Audit and cannot accept that bill. Visual’s correctly priced proposal for the same buyer/purchase/version fails with `PURCHASE_ALREADY_INVOICED`. Research’s balance and allowance are untouched, but the order is blocked.

The attacker must know the purchase ID. Random unshared identifiers reduce opportunistic guessing; they do not protect an ID once an order has been shared with a dishonest participant. This is an availability attack, not a demonstrated ability to debit the buyer.

**Proposed improvement:** establish a buyer-authorized order that binds the seller and terms before occupying its charge ID. A final invoice should refer to that exact authorization. Keep replay tombstones and versioned amendments, while preventing an unrelated proposer from permanently claiming an unapproved order.

### W04 — free sponsored storage can be consumed by unaccepted invoices

Public proposals and account activity use the vault’s native storage headroom. Invoice proposal has no equivalent per-account active-proposal quota; the four-round active limit does not bound invoice creation. A buyer does not have to accept before those storage records are created.

Reproduction: a registered trading signer submits distinct one-unit proposals without buyer acceptance, against a fixed simulated native balance. The storage grows until new proposals fail with `SPONSOR_STORAGE_HEADROOM_REQUIRED`. A legitimate proposal then fails for the same reason. The buyer’s purchase allowance stays zero.

A preallocated recovery withdrawal still completed in this test. The financial recovery design preserved existing funds, but honest agents could no longer create new business.

The demo’s HTTP session quotas do not bound a direct caller of the public contract. An attacker still pays its own NEAR transaction gas and needs a registered signer. This test is not a measured gas-cost estimate.

**Proposed improvement:** bound sponsored persistent records using buyer-authorized orders, per-identity quotas or sponsor vouchers. Budget sponsorship separately from token balances. Expiry should release active capacity while retaining enough minimal replay history to prevent rebilling. Removing visitor fees is compatible with bounded sponsorship.

### W05 — automatic clearing misses a valid subgroup

The [coordinator](../../services/coordinator/coordinator.mjs) tries all eligible public invoices, then individual invoices. It does not search intermediate subsets or funded cycles.

Reproduction: all three wallets have zero available funds. Visual owes Audit 0.100; Audit owes Visual 0.100; Research owes Audit another 0.100. The full set needs 0.100 from Research, and each singleton needs an unfunded debtor. A background tick settles nothing. Explicitly selecting the Visual/Audit cycle settles both bills with zero funding and two approvals, leaving the Research bill outstanding.

This does not give Research a protocol-wide veto. The manual subgroup path works as intended. It shows a gap in the autonomous coordinator’s proposal selection.

**Proposed improvement:** generate feasible intermediate groups, beginning with independent components and bounded cycle/subgraph candidates, and apply explicit waiting and funding constraints. Never carry approvals across changed groups. A heuristic need not promise a globally optimal result, but it should find common valid offsets without human intervention.

### W06 — selecting a group is not a lasting instruction to pause other bills

The coordinator starts automatic clearing after roughly 30 seconds when standing policies remain valid. It can settle singleton bills or the remaining group even if the owner deliberately chose a different manual set.

Reproduction: manually clear only Research-to-Visual for 0.100. The other two bills initially stay accepted. After 31 seconds, automatic clearing settles them with another 0.100 of net settlement volume. Total movement across the rounds is 0.200, compared with 0.020 had the original three bills cleared together. The first round required a 0.100 funded debtor rather than 0.020.

**Fresh hosted observation:** the public journey on 10 November also requested the complete 0.280 tUSDC group. Two full-group proposals received only Audit's approval, reported `SERVICE_UNAVAILABLE`, and later became STALE after a competing round consumed a selected invoice. The actual settled rounds were Research-to-Visual (gross/net 0.100) and the remaining Visual-to-Audit plus Audit-to-Research pair (gross 0.180, net 0.100). All three invoices settled exactly once, but total movement was **0.200 instead of 0.020 tUSDC**. Final public wallet balances were still correct: Research 0.980, Visual 0, Audit 0.020. This shows that automatic clearing can also preempt a requested full group during a service interruption. The financial success of the browser journey must not be presented as achieving the full group's 92.9% payment-volume reduction.

These transfers are authorized under the existing standing policies. This is not an unsigned-transfer exploit. It is a mismatch between a manual selection and what a human might expect the automated agents to keep waiting for.

**Proposed improvement:** expose a clear per-agent clearing policy: automatic versus manual scheduling, maximum wait, permitted groups/exclusions and optional savings preferences. Freeze manual request scope, preserve idempotence, and keep the settlement of an already READY round independent of scheduling preferences.

### W07 — a disappearing private counterparty can consume allowance

The [private purchase authorization](../../contracts/ach-v4/src/lib.rs) precharges the maximum invoice allowance and stores a commitment. Cancellation of an unfinalized purchase requires both buyer and seller; the authorization has no on-chain expiry field that releases that allowance.

Reproduction: a buyer with 0.100 total allowance authorizes one private purchase, requests cancellation alone and waits ten minutes. It stays AUTHORIZED with `buyer_cancelled=true`; a new purchase fails with `GROSS_PURCHASE_BUDGET_EXCEEDED`. No payment funds are reserved. The seller’s eventual cancellation releases the allowance correctly.

This strands trading capacity, not cash. The owner can deliberately establish a new policy epoch, but that is an owner intervention and must preserve the visibility of old outstanding exposure.

**Proposed improvement:** bind an order deadline and a bounded finalization/dispute window to its authorization. Give the parties a recovery outcome if no valid receipt is finalized within that window, while preventing cancellation after valid committed delivery from becoming a free-work attack.

### W08 — History does not yet cover every owner money action

The contract and SDK provide account activity and withdrawal records. The hosted snapshot primarily exposes coordinator/session events, work, invoices and rounds. Sponsor withdrawal, deposit, recovery and revocation methods do not append the corresponding session receipt events. Direct READY-round settlement in `tick()` also omits the coordinator’s `round-settled` transaction event.

Reproduction: the background tick settles a READY round; an owner withdraws and revokes authority. The chain account activity contains `round-settled`, `withdrawal-completed` and `agent-revoked`. The session event list has none of the corresponding receipt events. The snapshot still correctly reports the settled round and current balances.

A separate test adds 105 session events. The snapshot returns the oldest 100, omitting the newest five. The store supports an `after` cursor, but the public snapshot does not paginate it.

The redesigned History screen makes existing records navigable and searchable. It intentionally does not invent missing transfers, historical balances or transaction hashes.

**Proposed improvement:** reconcile paginated contract activity with the durable transaction journal; record owner transfer confirmations and background settlement receipts; provide a stable pagination cursor. Keep “submitted”, “restored/refunded” and “completed” distinct.

### W09 — a debtor can collect its credit while refusing its own accepted bill

This reproduction starts with **all three invoices accepted by both parties**. Audit owes Research 0.080 tUSDC and is owed 0.100 by Visual. Its malicious trading actor refuses every proposed group containing its outgoing 0.080 bill, including the complete group in which Audit would receive only 0.020. It approves a group containing only its incoming payment.

Two background ticks settle Research-to-Visual for 0.100 and Visual-to-Audit for 0.100. Research and Visual approve those freshly calculated smaller rounds under their existing policies. Audit then has 0.100 available and zero reserved. Its owner successfully withdraws that 0.100. A later tick leaves Audit-to-Research ACCEPTED and unpaid, with no Audit funds available to clear it. Research's wallet is 0.900 instead of the 0.980 outcome of the complete group; Audit collected 0.100 instead of its net 0.020 position across all three bills.

The isolated test reproduced both selective signing and the completed withdrawal against the actual compiled vault. The trading key itself cannot withdraw; the malicious owner performs that step. No public attack was executed. All settled smaller groups had exact participant consent, and no reserved money was drained. The exploit is the ability to collect an unsecured receivable while keeping an accepted outgoing obligation uncommitted.

**Proposed improvement:** retain independent subgroup consent, but make outstanding credit exposure part of the decision to approve a smaller group. Providers need an enforceable payment commitment before delivery. Where a proposed group removes an expected incoming offset, each honest agent should require the missing exposure to be secured or consciously approve the resulting credit risk. An owner-authorized collateral and withdrawal policy could also retain coverage for accepted obligations. Blocking unrelated honest subgroups or requiring approval from the whole network is unnecessary.

## Additional boundaries and improvements

### Privacy is scoped to contents, not complete economic invisibility

Private work is decrypted by hosted service processes while they perform it. Durable private records and worker contributions are encrypted, and the OutLayer worker verifies the private netting calculation. This does not prevent the host operator from accessing a service’s plaintext or keys. Participant identities, timing, public catalog prices and net positions also reveal information.

For a single one-way invoice, the public net debit equals its invoice amount. The fixed demo price catalog makes many amounts inferable even if the browser labels the underlying invoice record encrypted.

If covered trade amounts are required, private settlement/balances or stronger aggregation and disclosure rules are separate work. For protection from the service operator, independently hosted agents or attested service execution with appropriately bound key custody are needed. Keep these boundaries explicit in product claims.

### Custody includes the current deployment operator

The hosted sponsor creates and retains owner identities, and the vault retains upgrade authority. A pinned client code hash detects a changed deployment before client operations; it cannot itself stop a key holder replacing the contract. The current demo is suitable for test funds, not a claim of operator-proof production custody.

A real-money deployment needs independently controlled owner keys, an explicit upgrade/governance policy, token and custody verification, and independent security review. None of those authority changes were made during this task.

### Netting does not automatically pool one owner’s idle balances

Wallet balances are per account. Another agent having funds does not automatically fund a debtor account. Netting reduces debit requirements for the chosen obligations, but idle balances can remain fragmented.

An optional owner liquidity pool or explicitly delegated funding manager could reduce this remaining friction. It would need verified ownership, limits and withdrawal/consent rules; sharing an account-name prefix is not enough to prove common control.

### Cross-chain routing is separate from invoice clearing

Each vault clears one settlement token. The app obtains real mainnet quotes; mainnet transfers have not been exercised. The owner SDK routes funding and payouts with destination receipt checks, after/before separate deposits and withdrawals. This is not an atomic cross-chain netting round or a multi-currency PvP system.

Further evaluation should include actual low-value mainnet routes only when authorized and funded, including expiry, partial/refunded transfers and unavailable destination verification. No real-money route was sent during this review.

### The demo is a useful pilot, not a capacity benchmark

The demo uses three curated services, two briefs per session and bounded sponsored operations. The public protocol supports up to 12 round participants and 48 invoices; private rounds support six invoices. External agents can use their own signers, but public provider discovery, general delivery validation, large-network coordination and throughput measurements remain separate work.

A stronger next demonstration would vary participants, net debtors, timings, incomplete groups and collateral conditions. It should include an independent agent without relying on the fixed three-service cycle for every savings result.

### A fresh hosted wallet setup took about 188 seconds

In the fresh public session used for W06, the interval from session creation to READY was **187,848 ms**, with five setup-waiting events. This is one observed startup, not an average or latency percentile. It is substantial friction before a visitor can use the wallet even though the setup is sponsored and free to that visitor.

**Proposed improvement:** measure account/key registration, policy installation, funding and RPC confirmation separately, then improve the slow steps and show their progress and retry state. A prepared demo pool may improve first-use speed, but ownership, isolation, expiry and eventual real-wallet onboarding still need explicit handling. No setup or account-provisioning changes were made in this review.

### Fewer token movements do not yet mean fewer chain transactions

In the current public service flow, each invoice is proposed on chain and accepted separately by its seller and buyer. A three-invoice round then needs a proposal, three round approvals and settlement. That is 14 financial writes for the normal three-agent path, before wallet setup, deposits or withdrawals. A minimal direct-token-payment baseline would make three payment writes, with different service-payment assurances.

This is an implementation tradeoff, not a measured comparison of equivalent security or total gas. ACH reduces the cash and token movements needed for the chosen round, but its current invoice and approval workflow adds chain transactions and persistent records. The million-agent vision needs measurements of those costs. Signed order/receipt batching could reduce overhead, while retaining exact consent, purchase replay protection and enforceable funding commitments.

## Protections that held in the tests

- A funded READY round could not be cancelled or have its reserved amount withdrawn.
- Revoking authority after READY did not undo the funded commitment; settlement still completed.
- Repeating settlement did not pay twice.
- An incorrect exact net amount was rejected.
- Existing replay, gross-budget, transaction-journal and purchase-charge protections continued to pass the commerce regressions.
- Honest subgroup clearing required only that subgroup’s consent, recalculated its funding and left excluded bills outstanding.
- Sponsored-storage exhaustion did not prevent the preallocated recovery withdrawal in the tested case.

No unapproved drain of already reserved funds was demonstrated. That is a limited test result, not a proof that no other vulnerability exists.

## The decision behind the wallet model

Holding a balance in ACH and making that balance collectible for a particular purchase are separate steps. The current invoice acceptance gives the seller an agreed receivable; the later funded READY round gives it an enforceable settlement commitment. A provider needs to know which of those it has before spending its own money or releasing useful work.

Reserving every purchase's full exposure before delivery would close much of the buyer's refusal window, but would also tie up capital until safe offsets become known. Reducing that reservation using an unsigned future sale would reopen the same credit risk. For a known group, conditional orders can instead bind the complete obligation set and its required net funding before delivery. For an open purchase, the missing assurance must come from reserved exposure or a deliberately bounded, collateralized or underwritten credit arrangement. A signature, an expected future receipt and an OutLayer calculation are not substitute funding.

The delivery rule also matters. If a buyer can cancel after receiving a usable result, an early conditional reservation still permits free work. If a provider can collect for any correctly hashed artifact, a bad provider can charge for useless output. The order needs a service-specific release/acceptance rule, deadline and bounded dispute or refund outcome. The demo's format and source-URL checks cannot adjudicate arbitrary output quality.

Independent subgroup consent remains the right rule. It avoids requiring everyone in the network to cooperate. It cannot preserve an excluded member's incoming payment as an offset: the remaining agents must approve their recalculated positions and fund the resulting debit. Once that exact group is READY, no member should be able to remove a leg.

## Measure liquidity separately from payment volume

The live three-bill graph has 0.280 tUSDC of gross payments and can clear in one 0.020 tUSDC net-funded round, a 92.9% reduction in transferred value. This complete-group result was verified in the controlled public flow and the hosted private flow. The fresh hosted public journey instead split the bills into two rounds moving 0.200, as documented under W06. For those actual rounds, payment-volume reduction was 28.6%.

A direct payment order that recycles incoming receipts can execute those same bills with 0.100 tUSDC of starting cash: Research pays Visual 0.100, Visual pays Audit 0.100, and Audit returns 0.080 to Research. Against that specific baseline, the complete 0.020 net-funded round reduces the starting cash requirement by 80%. That improvement depends on successfully forming and committing the complete group.

Neither figure measures the capital needed to guarantee work before delivery. That comparison must include the chosen reservation/credit policy, payment order, settlement delay and defaults. At high agent transaction rates, even a short unsecured waiting period can accumulate substantial provider exposure. A useful next test should measure peak reserved cash and unsecured work separately across one-way payments, uneven graphs and a failed buyer, as well as the favorable three-agent cycle.

## Recommended order of work — not implemented

1. Decide and implement the pre-delivery payment/credit commitment model, including selective collection (W01/W02/W09).
2. Bind purchase IDs to buyer-approved sellers and bound sponsored records (W03/W04).
3. Improve autonomous subgroup selection and make scheduling policy understandable (W05/W06).
4. Add bounded private-order recovery and complete money history (W07/W08).
5. Validate independent-agent, privacy and cross-chain workflows against the stated deployment scope.

The strongest middle ground is to preserve independent subgroup consent and net-funded final settlement, while moving an explicit, bounded payment assurance decision earlier in the purchase workflow. Future incoming obligations cannot substitute for committed funding or consciously approved credit risk.
