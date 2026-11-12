# ACH

**Agent wallets with opt-in clearing on NEAR.**

[Live app](https://ach-rosy.vercel.app) · [Agent SDK](packages/client/README.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md)

The agent economy is coming. Agents can buy compute, exchange data, commission work and sell services. A single owner can operate many agents, each with its own budget and trading relationships.

That creates two payment problems: capital gets scattered across wallets, and agents need to know that their counterparties will honor agreed payments.

ACH combines agent wallets and clearing on NEAR. Owners fund their agents and set spending permissions. Agents agree their purchases, choose a clearing group and approve exactly what each participant will pay or receive. ACH reserves the required funds and settles the group together.

## Clear $280 of bills with $20

Three agents trade with one another:

| Agreed payment | Amount |
| --- | ---: |
| A owes B for a chart | $100 |
| B owes C for an audit | $100 |
| C owes A for research | $80 |
| **Total bills** | **$280** |

ACH subtracts what each agent is owed from what it owes:

| Agent | Owes | Is owed | Final position |
| --- | ---: | ---: | --- |
| A | $100 | $80 | Pays **$20** |
| B | $100 | $100 | Pays **$0** |
| C | $80 | $100 | Receives **$20** |

**A pays $20. C receives $20. All three bills are cleared.** Each agent has the same final net position as paying the bills separately.

This example moves **92.9% less value** than the $280 of gross payments. A sequential payment chain needs $100 of starting cash; the clearing group needs $20.

The live app uses the same pattern with test tokens: Research Desk owes Visual Studio 0.100 tUSDC, Visual Studio owes Audit Desk 0.100, and Audit Desk owes Research Desk 0.080. The group clears with a **0.020 tUSDC** net payment.

## Why clearing matters

[CLSSettlement](https://www.cls-group.com/products/settlement/clssettlement/) uses multilateral netting to reduce foreign-exchange funding requirements by over 96%, alongside payment-versus-payment settlement. Banks fund their net obligations while CLS settles the underlying trades.

The financial crises of **2008** and **2020** showed how quickly liquidity pressure can spread. The [Federal Reserve](https://www.federalreserve.gov/newsevents/testimony/bernanke20100902a.htm) describes the funding and counterparty stresses of 2008; [BIS](https://www.bis.org/publ/bisbull01.htm) describes the dollar-funding pressure in 2020.

An economy of continuously trading agents can face a similar problem: payments waiting on payments and capital scattered across wallets. ACH applies netting to agreed agent purchases so less cash is needed to clear connected trades.

## How it works

1. **Fund agent wallets.** The owner deposits the settlement token and sets purchase limits, permitted counterparties and services.
2. **Agree a clearing group.** Agents bind their purchase IDs, providers, prices, delivery terms and deadline.
3. **Approve and reserve.** Every participant approves its exact net position. Only net debtors reserve cash.
4. **Complete the work.** Buyers and sellers accept the deliveries. The complete group becomes ready for settlement.
5. **Settle together.** Anyone can settle the ready round. Available balances can fund another trade or be withdrawn by the owner.

Clearing is opt-in. Agents choose their counterparties and group before funding. A funded group settles as a whole; incomplete groups expire and release their reservations.

## Features

- **Owner-controlled wallets:** deposits, withdrawals and separate trading keys with spending limits.
- **Funded payment commitments:** agreed prices, purchase replay protection and atomic group settlement.
- **Private invoices:** encrypted contributions processed by the OutLayer worker, with participants approving the resulting net positions.
- **NEAR Intents quote previews:** USDC routes between Base and NEAR, with a separate SDK for owner-controlled funding and payouts.
- **Independent agents:** signer-backed SDK access without handing trading or owner keys to the coordinator.
- **Work and payment history:** deliverables, invoices, clearing rounds and transaction receipts in one workspace.

The live app runs on **NEAR testnet** with sponsored wallets and tUSDC that has no monetary value. Private invoice contents are encrypted; participant identities, timing and net movements remain public. The browser previews cross-chain quotes; executing an owner route requires separately funded accounts.

## Development

Use Node **22.22.2 or newer** and the Rust toolchain pinned in [rust-toolchain.toml](rust-toolchain.toml).

```sh
npm ci
npm run setup
npm run build
npm test
```

See [Development](docs/development.md) for local frontend configuration, browser tests and backend setup.

| Directory | Purpose |
| --- | --- |
| `contracts/ach-v4` | NEAR vault for wallets, purchases, clearing and withdrawals |
| `crates` | Shared protocol encoding, netting and runtime support |
| `workers/private-netting` | OutLayer worker for encrypted invoice processing |
| `packages/client` | Agent and owner SDK |
| `packages/intents` | Cross-chain quotes, owner routing and receipt reconciliation |
| `services` | Service agents, coordinator and wallet sponsorship |
| `web` | Next.js application |
| `tests/v4` | Contract, request and workspace tests |

## License

[MIT](LICENSE).
