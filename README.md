# ACH v4

**Agent wallets with opt-in clearing.**

[Try ACH](https://ach-rosy.vercel.app) · [Agent SDK](packages/client/README.md) · [Deployment and verification](docs/v4/README.md)

The agent economy is coming. [OpenAI is building infrastructure for agent commerce](https://developers.openai.com/commerce/), and [Anthropic is developing agents that use tools and act autonomously](https://www.anthropic.com/research/building-effective-agents). The opportunity extends far beyond a few agents buying services from one another: millions, and eventually billions, of agents could buy compute, exchange data, commission work and sell services across a connected economy.

A single person or business can operate many agents. Fast blockchains such as NEAR provide the transaction layer for that economy. As trading grows, two problems become central:

1. **Capital fragmentation.** Every agent needs money for its outgoing payments, while money it has earned may still be waiting elsewhere. Across many agents and trades, owners keep funding individual wallets even when much of the group's payments could offset.
2. **Payment trust.** A malicious agent can change prices, repeat charges, refuse its side of a trade or try to collect money while leaving others unpaid. Agents need payment rules that hold throughout a transaction.

ACH brings agent wallets and clearing into one system. Owners fund their agents and set spending permissions. Agents agree their purchases, choose a clearing group and authorize exactly what each participant will pay or receive. ACH reserves the required funds and clears the group's payments together, freeing capital for the next round of work.

## Netting: clear $280 of bills with $20

Three agents trade with one another:

| Agreed payment | Amount |
| --- | ---: |
| A owes B for a chart | $100 |
| B owes C for an audit | $100 |
| C owes A for research | $80 |
| **Total bills** | **$280** |

Paying each bill separately moves $100, then $100, then $80. ACH calculates what each agent owes **after subtracting what it is owed**:

| Agent | Money it owes | Money it is owed | Its final position |
| --- | ---: | ---: | --- |
| A | $100 | $80 | Pays **$20** |
| B | $100 | $100 | Pays **$0** |
| C | $80 | $100 | Receives **$20** |

**A commits $20. C receives $20. All three bills are cleared.** B's incoming and outgoing payments cancel each other. Each agent ends with the same financial result as paying the original bills separately.

That is **92.9% less value moving through payments** in this example. It also reduces the starting cash needed from $100 in a sequential payment chain to $20 for the agreed clearing group. The other $80 can keep working instead of circulating through intermediate payments.

The hosted revision-2 demo uses the same pattern at test-token prices: Research Desk owes Visual Studio 0.100 tUSDC, Visual owes Audit Desk 0.100, and Audit owes Research 0.080. Their complete group clears with **0.020 tUSDC** from Research. Visual and Audit supply no settlement cash for that group. The [November 10 findings](docs/v4/workflow-audit.md) describe the preceding release; its deployment and evidence are preserved separately.

Clearing is opt-in. The participating agents choose their group and approve its exact result. Independent groups can trade and clear alongside one another. Before committing a group, agents can leave out a counterparty and calculate a new group with its own funding and approvals.

## Why this matters: CLS and the financial crises

Netting already supports a major part of the global financial system. [CLSSettlement](https://www.cls-group.com/products/settlement/clssettlement/) uses multilateral netting to reduce foreign-exchange funding requirements by **over 96%**, alongside payment-versus-payment settlement. Banks fund their net obligations while CLS settles the underlying trades.

ACH brings that capital-saving principle to agent commerce: agreed payments offset, the remaining amounts are funded, and the group settles together.

The crises of **2008** and **2020** showed how quickly demand for liquidity can spread. In 2008, dependence on short-term funding and uncertainty about counterparties intensified the shock. In 2020, the pandemic created sudden pressure for dollar funding. [The Federal Reserve](https://www.federalreserve.gov/newsevents/testimony/bernanke20100902a.htm), [BIS](https://www.bis.org/publ/bisbull01.htm) and [CLS](https://www.cls-group.com/insights/the-fx-ecosystem/covid-19-and-the-importance-of-resilient-financial-market-infrastructures/) describe these stresses and the role of resilient settlement infrastructure.

An economy of continuously trading agents could develop similar pressure: payments waiting on payments, capital scattered across wallets, and many agents seeking liquidity at once. ACH addresses that problem at the payment layer. Netting reduces the cash needed to clear connected trades, and funded commitments give agents a dependable basis for doing business.

## From an owner's budget to an agent's next trade

1. **Fund the wallets.** The owner deposits the settlement token into ACH, allocates money to agents and sets their purchase and payment limits.
2. **Agree the work.** Agents agree the provider, service, price and delivery terms. Purchase IDs and spending rules bind those agreements.
3. **Commit the clearing group.** Each included agent approves its exact net payment or receipt. Net debtors reserve the required cash.
4. **Complete the work and payment.** The agreed deliveries and invoices bind the group's settlement. Useful output is released against the complete payment commitment.
5. **Put the balance back to work.** The group clears together. Agents can trade again, and owners can withdraw available balances.

The free demo prepares three service agents and their wallets. Give Research Desk a brief, follow its purchases from Visual Studio and Audit Desk, inspect the work and expand the clearing round. The round shows every bill, each agent's calculation, its approval and the settlement receipt.

Judges can keep trying briefs; the corrected version removes the two-brief restriction. **Start another test workspace** prepares fresh test wallets. Each workspace stays active for 24 hours; **Settings** lets the same browser reopen earlier active workspaces with their work, payments and receipts. Private results open using the keys retained by the browser that created them. Shared sponsorship budgets and short request intervals protect the demo's operating resources; there is no per-judge two-brief allowance. These features are available in the hosted revision-2 app.

**Work**, **Payments**, **Clearing**, **Wallets** and **History** make the complete journey visible. The owner can inspect spending permissions, deposits, withdrawals and available cash from the same workspace.

## What ACH provides

- **Agent wallets.** Confirmed balances, owner-controlled deposits and withdrawals, and delegated trading keys with spending limits.
- **Opt-in clearing.** Groups of consenting agents settle agreed payments together, using their final net positions.
- **Payment commitments.** Exact prices, purchase replay protection, reserved funds and complete-group settlement.
- **Private processing with OutLayer.** Encrypted invoice contributions are verified and netted by the pinned worker. Participants approve the group's disclosed net movements.
- **NEAR Intents funding and payouts.** The owner SDK connects cross-chain routes to wallet funding and withdrawals, with quote approval, transaction journaling and destination receipt checks. The app includes live Base ↔ NEAR USDC quote previews.
- **Independent agent participation.** Agents can bring their own trading signers through the SDK, agree purchases and verify their own clearing positions.
- **Receipts and History.** Expand rounds to see how clearing happened, follow money actions and export records.

The sponsored demo runs on NEAR testnet with tUSDC. Visitors use it free: the sponsor covers registration, gas, storage, inference and OutLayer execution. The test tokens have no monetary value. Private processing protects invoice contents; participants, net movements and timing are visible in settlement. Mainnet route execution uses separately funded owner accounts.

## Build and run

Use Node 22.22.2 or newer and the Rust toolchain and Wasm targets pinned in `rust-toolchain.toml`.

```sh
npm ci
npm ci --prefix packages/core
npm ci --prefix packages/client
npm ci --prefix agent
npm ci --prefix web
npm run build --prefix packages/core
npm run build:v4
npm run build --prefix web
cargo test --locked --workspace
npm run test:wasm
npm run test:services
npm test --prefix packages/client
npm test --prefix packages/intents
npm run test:security
npm test --prefix packages/core -- --maxWorkers=1
npm test --prefix agent
node scripts/v4/private-test.mjs
node scripts/v4/browser.mjs --sdk-only
```

The local browser journey runs with `npm run test:e2e -- --local`. It uses generated identities, the actual vault/token Wasm and the native private worker, and requires local listener and Chromium permissions. [Current validation](docs/v4/security-review-20261111.md) records which checks completed in this environment.

| Directory | Purpose |
| --- | --- |
| `contracts/ach-v4` | Wallets, purchases, funding commitments, clearing and withdrawals |
| `contracts/test-usdc` | The demo's settlement token |
| `crates/ach-protocol` | Canonical encoding, integer netting and commitment hashes |
| `workers/private-netting` | OutLayer receipt verification and private netting |
| `packages/client` | The signer-backed agent SDK |
| `packages/intents` | Owner funding, payout routes and receipt reconciliation |
| `services` | Independent service agents, coordinator and sponsorship |
| `web` | The ACH site and clearing workspace |
| `tests/v4` | Financial and workflow verification |
| `docs/v4` | Deployment, release evidence and engineering reports |

The [deployment notes](docs/v4/README.md), [workflow review](docs/v4/workflow-audit.md), [correction record](docs/v4/workflow-fixes.md) and [local security validation](docs/v4/security-review-20261111.md) provide the engineering evidence. Deployment identities and test results are recorded alongside the source. Private keys, service credentials and browser decryption state stay in private deployment stores.

## Verification update — 11 November 2026

**169 automated tests passed**, alongside the production web build, actual contract/worker builds and a fresh installation of both downloadable SDKs. Recent checks cover paid planner retries across restarts, maximum-length 48-order groups, stored wallet identities, isolated service namespaces and publication checks that reject incomplete evidence. Browser journeys, the legacy integration suite, a current dependency advisory result and a corrected live deployment still need verification; the [validation report](docs/v4/security-review-20261111.md) records their exact status.

## Verification update — 12 November 2026

The verified source passes **256 automated tests**, including all 58 legacy tests, 14 agent tests and six browser-checkpoint regressions. Three separate local browser runs each pass **66 checks**, covering repeat briefs, fresh workspaces, private results, funding, clearing and History. Timeout and restart regressions recover the original public or encrypted private result without another charge. Both live maximum-size rounds also settle: 12 participants and 48 invoices per round, with the largest measured operation using 119.721 TGas. All six tracked dependency lockfiles were scanned; the legacy toolchain retains 16 low-severity upstream findings with tested local mitigations. The [latest validation and release record](docs/v4/validation-20261112.md) distinguishes completed hosted checks from remaining acceptance work. Mainnet transfers remain untested.
