# ACH v4 — a clearing house for the agent economy

[Try ACH for free](https://ach-rosy.vercel.app) · [Developer guide](https://ach-rosy.vercel.app/developers) · [Live deployment](https://ach-rosy.vercel.app/proof)

The agent economy is coming. Agents will buy research, generate work, check results and sell services to other agents. A single person or business may operate many of them. ACH’s long-term goal is a clearing layer for a network of millions of agents trading across many counterparties.

NEAR provides a fast blockchain settlement layer. At large scale, paying every service invoice separately still creates two practical problems:

1. **Capital fragmentation.** Money becomes spread across agents and payment routes. Funding each outgoing bill independently can tie up more money than the group’s final obligations require.
2. **Payment trust.** Some agents will submit wrong prices, repeat charges, refuse payment or leave a transaction partly completed. Useful commerce needs explicit terms, spending permissions and a dependable settlement process.

ACH gives agents wallet balances in a shared vault, records accepted service invoices, and lets a consenting group clear its bills together. Each included agent approves the exact invoice set and its final amount. Net debtors reserve confirmed funds. The fully funded round settles all its included balances and invoices in one contract execution.

This reduces funding needs where payments offset and protects the final settlement commitment. An accepted invoice remains a receivable until settlement; providers still need a policy for validating and releasing work.

## What netting does

Netting subtracts what an agent owes from what it is due. Consider the demo’s three service payments:

| Agreed bill | Amount |
| --- | ---: |
| Research Desk owes Visual Studio for a chart | 0.100 tUSDC |
| Visual Studio owes Audit Desk for checks | 0.100 tUSDC |
| Audit Desk owes Research Desk for references | 0.080 tUSDC |
| Gross invoice value | **0.280 tUSDC** |

The clearing result is:

| Agent | Is due | Owes | Final movement |
| --- | ---: | ---: | ---: |
| Research Desk | 0.080 | 0.100 | Pays **0.020** |
| Visual Studio | 0.100 | 0.100 | No transfer |
| Audit Desk | 0.100 | 0.080 | Receives **0.020** |

The group needs 0.020 tUSDC of net funding. The 0.280 tUSDC gross invoice value describes the work purchased. It is not a claim that every payment graph achieves the same reduction.

Owners deposit the settlement token into ACH and credit their agents’ wallets. They need enough available cash to cover each agent’s final payment in the selected group. The demo preloads Research Desk with 1.000 tUSDC as a buffer; the full three-bill round above needs only 0.020 from Research. Visual and Audit do not need to deposit cash for that round. A bill cleared alone still requires its full amount.

Only the included subgroup must approve. Other agents can continue trading or form another round. Removing a participant changes the calculation: clearing just the Research-to-Visual bill requires 0.100 tUSDC and leaves the other two bills outstanding. Existing approvals cannot authorize a changed invoice set.

The public site also contains a labelled illustration with bills of 100, 80 and 60, clearing with 40. Its sample figures are separate from the live testnet service prices.

## The financial precedent: CLS, 2008 and 2020

Foreign exchange already operates at a scale where gross funding would be expensive. [CLSSettlement](https://www.cls-group.com/products/settlement/clssettlement/) combines multilateral netting of funding requirements with payment-versus-payment settlement. The two currency payments settle together. CLS reports funding reductions of over 96%; that figure belongs to CLS and is not an ACH benchmark.

[CLSNet](https://www.cls-group.com/products/processing/clsnet/) is a separate bilateral netting-calculation service. ACH’s one-token invoice clearing is a different mechanism from settling both currency legs of an FX trade.

In the 2008 crisis, dependence on short-term funding, leverage and uncertain exposures helped turn losses into widespread liquidity stress. The [Federal Reserve’s September 2010 account](https://www.federalreserve.gov/newsevents/testimony/bernanke20100902a.htm) describes those mechanisms. In its [April 2020 resilience account](https://www.cls-group.com/insights/the-fx-ecosystem/covid-19-and-the-importance-of-resilient-financial-market-infrastructures/), CLS describes banks relying on final FX settlement during 2008.

The pandemic shock of 2020 caused another sharp demand for dollar funding. [BIS Bulletin 1](https://www.bis.org/publ/bisbull01.htm) documents the pressure in FX swap markets. CLS reported March daily payment volumes about 20% above normal without issues or delays. Net funding, settlement controls and operational resilience all contributed to that outcome.

A future agent economy could face similar payment pressure if many agents need cash at the same time, hoard balances, or depend on receipts that have not settled. Netting can reduce the cash needed for offsetting obligations. It cannot create the remaining net funding, resolve insolvency, validate every service or guarantee that a crisis will be prevented.

The direction toward agent commerce is supported by the [OpenAI and Stripe Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol). ACH’s proposed market scale is a long-term vision, not a claim about the number of agents trading today or this prototype’s throughput.

## Try the workflow

The sponsored demo uses NEAR testnet and a six-decimal test USDC token with no monetary value. Visitors pay no registration, gas, storage, inference or OutLayer charges. Session and usage limits bound the sponsor budget.

1. Start a free session. Three hosted service agents and their test wallets are prepared for you.
2. Open **Work**, edit the brief and dataset, and choose the deliverable and invoice visibility. Research Desk uses a model to plan purchases.
3. Review the delivered chart, reference packet and data checks. The checks validate data format and known source URLs; they do not certify that user-supplied facts are true.
4. Open **Payments** to inspect the agreed bills. In **Clearing**, select the agents and exact invoices, then review the funding requirement.
5. Expand a clearing round to see the bound bills, each agent’s incoming and outgoing amounts, approvals and settlement record.
6. Use **Wallets** to inspect available money, reservations, withdrawals and deposits. **History** provides recorded work, bills and clearing rounds with search, filters and exports.

Standing trading permissions allow the agents to approve eligible rounds automatically. The current coordinator tries clearing after bills have waited roughly 30 seconds, including individual bills when a larger group cannot clear. Selecting a manual round does not permanently pause excluded bills.

## Owner and agent authority

Owners register accounts, deposit tokens, manage permissions and withdraw available funds. Trading keys have counterparty, service, maximum-invoice, gross-purchase-budget, net-commitment and expiry limits. Netting does not bypass the gross purchase allowance.

The coordinator proposes and relays rounds. The three service processes retain separate trading signers. Independently operated agents can use the downloadable SDK with their own signers; see [the client guide](packages/client/README.md).

Invoice acceptance consumes purchase allowance. Cash is reserved when an agent approves its net debit in a clearing round. A READY round has all required approvals and funding; its commitment is irrevocable and anyone can settle it. External withdrawals complete separately and restore the claim if a token transfer fails.

The hosted identities and remaining vault upgrade authority are recorded in [the deployment manifest](docs/v4/deployment.json). This is a hackathon deployment that has not received an independent security audit.

## Private netting with OutLayer

Choose private invoices before sending the brief. The browser encrypts the brief for the service. Providers receive the work they need to perform; their durable private records are encrypted. Private invoice contributions are encrypted for the pinned OutLayer worker.

Receipt verification records the accepted private charges with zero disclosed movements. A private clearing computation requires disclosure consent from every included participant. Agents then authorize the exact resulting settlement round. The public contract does not receive the private invoice contents.

Participant identities, timing, net positions and external transfers remain public. The original browser opens encrypted demo results. Hosted service processes handle plaintext while performing work; this is not a claim that the operator cannot access private inputs. Losing the browser’s decryption key can make its stored results inaccessible.

## Funding and payouts with NEAR Intents

The app obtains real dry mainnet USDC quotes between Base and NEAR. The owner routing SDK validates the quote, journals source transfers and checks destination receipts before marking a route complete. Funding arrives at the owner before a separate ACH deposit; payouts withdraw to the owner before routing.

Mainnet transfers have not been exercised. Execution requires a separately funded mainnet vault and an owner-operated source signer. Each vault clears one settlement token. External routes have separate receipts and recovery states from internal clearing. See [the owner routing guide](packages/intents/README.md).

## Workflow review

The [workflow audit and proposed improvements](docs/v4/workflow-audit.md) document reproduced unpaid-delivery, selective credit collection, purchase-ID blocking, sponsored-storage and history limitations. Its 18 report-only tests describe current behavior. A malicious debtor could collect an incoming payment through a smaller round, withdraw it, and leave its already accepted outgoing bill unpaid. Those audit fixes have **not** been implemented.

The fresh hosted public journey passed 43 financial and interface checks, but automatic clearing split the three demo bills into two rounds moving **0.200 tUSDC instead of 0.020**. Every bill settled once and final balances were correct. That same session took **187,848 ms** to prepare its wallets; this is one observation, not an average. [Release evidence](docs/v4/release.json) preserves these workflow findings alongside the passing checks.

## Repository

| Path | Purpose |
| --- | --- |
| `contracts/ach-v4` | Rust vault, invoices, consent, reservations, clearing and withdrawal recovery |
| `contracts/test-usdc` | Testnet-only settlement token |
| `crates/ach-protocol` | Canonical encoding, checked integer netting and hashes |
| `workers/private-netting` | OutLayer receipt verification and netting worker |
| `packages/client` | Signer-backed financial SDK and transaction reconciliation |
| `packages/intents` | Quote validation, owner routing and destination receipt checks |
| `services` | Durable coordinator, sponsor and service agents |
| `web` | Public site and agent workspace |
| `tests/v4/workflow-audit.test.mjs` | Report-only adversarial workflow checks |
| `docs/design/ux-research.md` | Public-source design and financial research |
| `docs/v4` | Current deployment and verification evidence |

## Build and verify

Use Node 22.22.2 or newer, the pinned Rust toolchain, and the Wasm targets listed in `rust-toolchain.toml`. Browser verification requires Playwright Chromium and its system libraries.

```sh
npm ci
npm ci --prefix packages/client
npm ci --prefix web
npm run build:v4
npm run build --prefix web
cargo test --locked --workspace
npm run test:wasm
npm run test:services
npm test --prefix packages/client
npm test --prefix packages/intents
node --test --test-concurrency=1 --experimental-test-isolation=none tests/v4/workflow-audit.test.mjs
```

Live tests require an explicitly selected private deployment namespace. Keys, service credentials, durable stores, browser state and private documents stay outside source. Follow [the release operations notes](docs/v4/README.md); preserve existing balances, keys and state when continuing a deployment.

The earlier TypeScript contracts and clearing agent remain available for historical inspection. Their commands are archived in [the v2 documentation](docs/legacy/README-v2.md).
