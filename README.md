# ACH v4 — a clearing house for the agent economy

> Once agents can spend, their capital fragments. We built a clearing house so they can settle large volumes of commerce with minimal liquidity, privately if needed.

[Try ACH on NEAR testnet](https://ach-rosy.vercel.app) · [Developer guide](https://ach-rosy.vercel.app/developers) · [Live deployment](https://ach-rosy.vercel.app/proof)

Agents buy research, commission work, check results and sell services to other agents. ACH gives them a shared clearing layer for those payments.

NEAR provides a fast blockchain settlement layer. At large scale, paying every service invoice separately still creates two practical problems:

1. **Capital fragmentation.** Money becomes spread across agents and payment routes. Funding each outgoing bill independently can tie up more money than the group’s final obligations require.
2. **Payment trust.** Some agents will submit wrong prices, repeat charges, refuse payment or leave a transaction partly completed. Useful commerce needs explicit terms, spending permissions and a dependable settlement process.

ACH gives agents wallet balances in a shared vault. They agree the complete order set, and ACH calculates each participant’s net position before funds are reserved. Every participant approves the group and its exact net amount. Only net debtors reserve confirmed funds. Once the required invoice commitments are complete, NEAR settles the group’s balances and invoices in one contract execution.

Netting reduces funding needs where payments offset. Reservation locks the required cash; settlement applies the final debits and credits together.

## What netting does

Netting subtracts what an agent owes from what it is due. For example, three agents agree these service payments:

| Agreed bill | Amount |
| --- | ---: |
| Research Desk owes Visual Studio for a chart | 100 tUSDC |
| Visual Studio owes Audit Desk for checks | 100 tUSDC |
| Audit Desk owes Research Desk for references | 80 tUSDC |
| Gross invoice value | **280 tUSDC** |

The clearing result is:

| Agent | Is due (tUSDC) | Owes (tUSDC) | Net settlement |
| --- | ---: | ---: | ---: |
| Research Desk | 80 | 100 | Pays **20 tUSDC** |
| Visual Studio | 100 | 100 | No transfer |
| Audit Desk | 100 | 80 | Receives **20 tUSDC** |

**280 tUSDC in bills clears with 20 tUSDC of settlement funding.** Each agent ends with the same balance change as paying the original bills separately. These are illustrative amounts; the hosted demo uses the same pattern with smaller test-token prices.

Owners deposit the settlement token into ACH and credit their agents’ wallets. For this group, Research reserves 20 tUSDC. Visual and Audit need no settlement cash. Settlement debits Research by 20 tUSDC and credits Audit by 20 tUSDC.

Agents choose their group before funding. Clearing only the Research-to-Visual bill would require 100 tUSDC. A changed order set requires fresh approvals. Once a group is funded, its bills must clear together; incoming bills cannot be collected separately while leaving the group’s outgoing bills unpaid.

Other agents can continue trading or form separate clearing groups.

## The financial precedent: CLS, 2008 and 2020

Foreign exchange already operates at a scale where gross funding would be expensive. [CLSSettlement](https://www.cls-group.com/products/settlement/clssettlement/) combines multilateral netting of funding requirements with payment-versus-payment settlement. The two currency payments settle together. CLS reports funding reductions of over 96%; that figure belongs to CLS and is not an ACH benchmark.

[CLSNet](https://www.cls-group.com/products/processing/clsnet/) is a separate bilateral netting-calculation service. ACH’s one-token invoice clearing is a different mechanism from settling both currency legs of an FX trade.

In the 2008 crisis, dependence on short-term funding, leverage and uncertain exposures helped turn losses into widespread liquidity stress. The [Federal Reserve’s September 2010 account](https://www.federalreserve.gov/newsevents/testimony/bernanke20100902a.htm) describes those mechanisms. In its [April 2020 resilience account](https://www.cls-group.com/insights/the-fx-ecosystem/covid-19-and-the-importance-of-resilient-financial-market-infrastructures/), CLS describes banks relying on final FX settlement during 2008.

The pandemic shock of 2020 caused another sharp demand for dollar funding. [BIS Bulletin 1](https://www.bis.org/publ/bisbull01.htm) documents the pressure in FX swap markets. CLS reported March daily payment volumes about 20% above normal without issues or delays. Net funding, settlement controls and operational resilience all contributed to that outcome.

A future agent economy could face similar payment pressure if many agents need cash at the same time or depend on receipts that have not settled. Netting reduces the cash needed to clear offsetting obligations; net debtors supply the remaining funding.

The direction toward agent commerce is supported by the [OpenAI and Stripe Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol). ACH’s proposed market scale is a long-term vision, not a claim about the number of agents trading today or this prototype’s throughput.

## Try the workflow

The sponsored demo uses NEAR testnet and a six-decimal test USDC token with no monetary value. Visitors pay no registration, gas, storage, inference or OutLayer charges. Session and usage limits bound the sponsor budget.

1. Start a free session. Three hosted service agents and their test wallets are prepared for you.
2. Open **Work**, edit the brief and dataset, and choose the deliverable and invoice visibility. Research Desk uses a model to plan purchases.
3. Review the delivered chart, reference packet and data checks. The service workflow begins against a funded group and releases the results once the complete group is READY or SETTLED.
4. Open **Payments** to inspect the agreed bills. In **Clearing**, open the group to review its complete invoice set and net funding requirement.
5. Expand a clearing round to see the bound bills, each agent’s incoming and outgoing amounts, approvals and settlement record.
6. Use **Wallets** to inspect available money, reservations, withdrawals and deposits. **History** provides recorded work, bills and clearing rounds with search, filters and exports.

Standing trading permissions allow the hosted agents to authorize eligible purchase groups. In automatic mode, the coordinator settles rounds when they become READY. Funded groups retain their complete invoice set throughout this process.

## Owner and agent authority

Owners register accounts, deposit tokens, manage permissions and withdraw available funds. Trading keys have counterparty, service, maximum-invoice, gross-purchase-budget, net-commitment and expiry limits. Netting does not bypass the gross purchase allowance.

The coordinator proposes and relays rounds. The three service processes retain separate trading signers. Agents can use the downloadable SDK with their own accounts and signers; see [the client guide](packages/client/README.md).

Group approval consumes gross purchase allowance and reserves only the agent’s net debit. In public groups, the buyer’s funded-order authorization is reused for its invoice; the seller accepts the matching bill. Private invoice contributions include both parties’ signatures.

A READY round has all required approvals, funding and invoice commitments. Anyone can settle it, including after its deadline or trading-policy revocation. An incomplete group can expire at its agreed deadline, releasing reservations and unused purchase allowance. External withdrawals complete separately and restore the claim if a token transfer fails.

## Private netting with OutLayer

Choose private invoices before sending the brief. The browser encrypts the brief for the service. Providers receive the work they need to perform; their durable private records are encrypted. Private invoice contributions are encrypted for the pinned OutLayer worker.

OutLayer verifies the encrypted, signed invoices and computes their net positions. Every included participant authorizes disclosure of the group’s net positions. The verified result must match the complete funded commitment before NEAR marks the round READY. The public contract receives commitments and net positions while invoice contents remain encrypted.

Participant identities, timing, net positions and external transfers remain public. Providers receive the inputs needed to perform their services. The browser that created the private brief holds the keys needed to open its encrypted results.

## Funding and payouts with NEAR Intents

Try ACH clearing on **NEAR testnet**. The current owner-routing SDK supports **NEAR and Base**. Execution support for other chains is under development.

The app previews cross-chain funding and payout routes between assets in the live Intents catalogue and NEAR USDC using mainnet dry quotes. The owner-routing SDK validates approved quotes, journals source transfers and checks destination receipts. Funding reaches the owner before an ACH deposit; payouts withdraw to the owner before routing. Vault clearing uses one settlement asset on NEAR. Executing owner routes requires a separately configured mainnet vault and funded owner accounts; see [the owner routing guide](packages/intents/README.md).

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
| `tests/v4` | Contract Wasm, financial and interface checks |
| `services/test` | Service, signing, provisioning and recovery checks |
| `docs/architecture.md` | Current workflow, authority and routing boundaries |
| `docs/development.md` | Setup, tests and deployment |

## Build and verify

Use Node 22.22.2 or newer, the pinned Rust toolchain, and the Wasm targets listed in `rust-toolchain.toml`. Browser verification requires Playwright Chromium and its system libraries.

```sh
npm ci
npm run setup
npm run build
npm test
```

For local browser checks, run `npm run test:e2e -- --local` with Playwright Chromium installed. Live tests require an explicitly selected private deployment namespace. Keys, credentials, durable stores and browser state stay outside source. Follow the [development and deployment guide](docs/development.md) when operating a separate instance or continuing an existing deployment.
