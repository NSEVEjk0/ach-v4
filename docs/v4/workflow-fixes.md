# ACH v4 workflow corrections

The published baseline is `07c55490c8676efc1c59677d9dbc494d1e389847`. The [10 November review](workflow-audit.md) records the reproduced failures in that version. This document tracks the subsequent corrections; a passing baseline review is not evidence that these changes are deployed.

## Payment before useful delivery

An agreed purchase group names its orders, counterparties, deadlines and exact net positions before execution. Each participant independently authorizes that group. Only the group's net debtors reserve cash. A one-order group requires that purchase's full payment; a closed group can offset its agreed purchases.

Once funded, its orders cannot be settled individually or substituted into another group. Public services bind the exact output commitment in the order. Final useful output is released only after the complete group becomes irrevocably payable. Private receipts continue to require both parties' signatures and OutLayer verification of the exact complete group.

An incomplete group expires at its agreed deadline and releases its reservations and unused allowance. Providers must withhold useful output until the complete payment commitment exists. This does not adjudicate arbitrary service quality or insure execution costs in an incomplete group. The demo's service acceptance rules cover its three deterministic formats.

## Other corrections

- Buyer-authorized orders occupy purchase IDs; unrelated sellers cannot claim them.
- Sponsored persistent records have account limits, including direct contract callers.
- Automatic clearing searches common feasible components and cycles. A manual clearing policy persists, and active requests protect their invoice scope.
- Private order expiry restores unused allowance without requiring a missing counterparty.
- History combines current contract activity and durable receipts, with pagination and explicit transfer states.
- Wallet setup records stage progress and combines compatible account operations while retaining durable retry identifiers.

## Finding coverage

| Finding | Correction in workflow revision 2 |
| --- | --- |
| W01 — unsecured accepted invoices | Participants authorize the exact order group and reserve its net debits before providers execute. Useful output requires the complete READY or SETTLED group. |
| W02 — unpaid customer leaves subcontract costs | Dependencies belong to the same funded group, and providers initially return commitments. Useful artifacts are withheld while any group delivery is incomplete. Execution costs in an expired incomplete group remain a provider risk. |
| W03 — purchase ID poisoning | Buyer authorization occupies the purchase charge; invoice and group IDs bind their intended buyer/proposer namespace. A foreign seller cannot claim an unapproved purchase. |
| W04 — shared sponsored storage exhaustion | Sponsored registration and persistent-record quotas apply on chain: 128 visitor records, with a separate 4,096-record coordinator limit. Terminal storage is reserved before admitting commitments. |
| W05 — missed feasible subgroup | The coordinator considers bounded connected components and cycles, respects protocol limits and permits unrelated feasible groups to proceed. This is a bounded heuristic. |
| W06 — automatic clearing overrides manual selection | Manual scheduling persists across restart. Active requests protect their exact scope. A funded order group cannot be split into a replacement round. |
| W07 — missing private counterparty strands allowance | Incomplete groups have an enforceable deadline and an expiry path that releases cash and unused private purchase allowance once, retaining replay protection. |
| W08 — incomplete money History | Recorded owner transfers and background settlement receipts join contract and session activity. Latest events and stable pagination are available, with submitted, completed and refunded states kept distinct. |
| W09 — selective collection of incoming credit | Funded orders and their receipts clear only as their complete group. A participant cannot collect one incoming leg while refusing its committed outgoing leg. |

The [local security and validation report](security-review-20261111.md) records the implementation paths, additional findings, exact commands and limitations. **169 automated tests passed**, including the actual vault/token Wasm, native private worker integration, SDK and routing regressions, direct API handler tests, and a 12-participant/48-order funding test with multiple debtors and no spare sponsor storage at settlement. Actual Wasm also completed two maximum-field-length 48-order groups with 96 accumulated receipts. The production web build and an isolated offline installation of both downloadable SDK archives also passed; the SDK import process writes its own verification evidence.

Repeat judging has no two-brief allowance. Fresh workspaces keep independent wallets and reopen earlier active workspaces in the same browser during their 24-hour sessions. Shared resource budgets remain bounded. Planner attempts are recorded before each paid request, so retries and restarts cannot exceed two attempts per admitted brief. Revision-2 service units, ports, stored identities and child environments are tied to their fresh deployment namespace.

The November 11 checkpoint could not complete browser, legacy integration or vulnerability-feed checks because of sandbox and DNS restrictions. The [November 12 validation](validation-20261112.md) records their subsequent completion, 256 automated tests, three local 66-check browser passes, current dependency findings and the deployed revision-2 candidate. Historical failed runs remain preserved.

The corrections are published to the private `ach-v4` repository and deployed in the fresh revision-2 namespace. The November 10 deployment and historical reports remain separate; its existing orders have not acquired the new funding assurance. Current hosted acceptance and final evidence are tracked in the latest validation record.
