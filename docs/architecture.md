# Architecture

ACH separates wallet ownership, agent trading authority and settlement. One vault clears a single settlement token.

## Components

| Component | Responsibility |
| --- | --- |
| NEAR vault | Balances, spending policies, purchase groups, reservations and settlement |
| Settlement token | Deposits into the vault and withdrawals to owner accounts |
| Protocol crate | Canonical encoding, integer netting and commitment hashes |
| Service agents | Run the scripted research, chart and audit workflow through distinct trading signers |
| Coordinator | Collect agreed groups, track work and submit ready rounds |
| OutLayer worker | Process encrypted invoice contributions and return committed net positions |
| Client SDK | Owner and agent transactions with durable reconciliation |
| Judge test harness | Generate signed synthetic bills for 3–12 agents and settle public or private testnet rounds |
| Web app | Work, wallets, invoices, larger netting tests, clearing rounds and history |

Vercel serves the frontend. A VPS runs the coordinator, sponsored wallet management and scripted service agents. OutLayer performs encrypted invoice verification and netting; the NEAR contract enforces authority, reservations and settlement. Running an application agent service on the VPS means its service code and test signer run there; its payment approval still comes from that agent's distinct trading key.

## Wallets and authority

Owners deposit the settlement token and set an agent's permitted services and counterparties, maximum invoice, gross purchase budget, maximum net commitment and expiry.

Owner signers control registration, policies, deposits and withdrawals. Trading signers authorize purchases and rounds within the owner's policy. A coordinator cannot approve another participant's net debit.

Hosted sponsored wallets have operator-managed owner and trading keys. The operator holds these test keys, and each account has a separate signing identity and scoped authority. Agents integrated through the SDK can retain their own owner and trading keys outside the coordinator.

The vault separates available balances, reserved balances and pending withdrawals. A failed external token transfer restores the owner's balance claim.

## Funded purchases and clearing

A purchase group binds its complete order set, participants, net positions and deadline. Every included participant approves the same group and its own exact net amount. Only net debtors reserve cash.

```mermaid
flowchart LR
    Agreements[Agreed orders] --> Approvals[Participant approvals]
    Approvals --> Funded[FUNDED group]
    Funded --> Deliveries[Accepted deliveries]
    Deliveries --> Ready[READY round]
    Ready --> Settlement[Atomic settlement on NEAR]
```

Providers start work against the funded group. Once all required deliveries are accepted, the group becomes ready. Anyone can submit settlement; the vault applies all balance movements together.

An incomplete group expires at its agreed deadline and releases reservations and unused purchase allowance. A ready commitment remains enforceable after its deadline or trading-policy revocation. Its bills cannot be collected through separate settlements.

Public rounds support up to 12 participants and 48 invoices. Netting uses integer token amounts and never combines different assets.

## Private invoices

Private contributions contain both parties' signatures and are encrypted for the pinned OutLayer worker. Each contribution is padded to 2048 plaintext bytes. Private rounds support up to **12 participants and six bills**.

Participants authorize disclosure of the group's net positions before netting. With `private.batch_funded_invoices = true`, the commerce workflow stages all three signed invoices and runs OutLayer once to verify and net the complete funded group. Results remain locked until the chain marks that group READY or SETTLED. Existing in-progress receipt workflows retain separate invoice verification; receipt processing alone does not authorize a payment. In both paths, the verified positions must match the participants' complete funded commitment.

Invoice contents are encrypted; participant identities, timing and net movements remain public. Providers receive the inputs required to perform their own services.

## Judge tests and demo bounds

The Clearing page can create fresh workspaces with 3–12 distinct testnet accounts and trading signers. The tests use synthetic bills and predetermined delivery commitments so judges can exercise signing, reservations, netting and settlement without model inference or SDK setup.

Public tests form a payment cycle: the first bill is 0.100 tUSDC and each remaining bill is 0.080. Twelve agents therefore clear 0.980 tUSDC of bills with a 0.020 tUSDC net settlement. Private tests use the same cycle for up to six agents. Seven–12 agents use six bills across separate payment paths; at twelve agents there are six pairs, no offsetting payments and a 0.500 tUSDC settlement.

Research starts with 1 tUSDC; Visual and Audit start with zero. Each extra test wallet receives 1 tUSDC. Sponsored sessions expire after 24 hours and allow twelve synthetic netting requests and 48 Intents previews, within spending and sponsorship limits. Creating another workspace remains subject to the deployment's sponsor budget and rate limits.

Fresh wallet provisioning batches compatible actions and installs policies with distinct owner signers in parallel. This reduces the default three-wallet flow to approximately eleven transactions when private computation funding is enabled. Chain confirmations and sponsor queues still affect elapsed time; this transaction count is not a measured speed result.

## Cross-chain routes

NEAR Intents routing is separate from vault clearing. Incoming routes reach the owner before a vault deposit. Outgoing routes withdraw to the owner before sending the approved cross-chain transfer.

The browser offers funding previews from a selected asset into pinned NEAR USDC, and payout previews in the reverse direction. Assets come from the live 1Click catalogue, with `nep141:`, `nep245:` and `1cs_v1:` identities and each token's decimal precision preserved. Catalogue availability does not guarantee route liquidity or minimum amounts. XRP tags require X-address encoding; separate classic-address tags are unsupported. Zcash recipients can use transparent or TEX addresses; shielded addresses are unsupported.

All browser requests are mainnet `dry: true` quotes: they create no executable deposit address, send no cross-chain transfer and cannot credit the testnet vault. NEAR Intents has no official testnet. ACH mainnet deployment and execution remain deferred.

The separate owner-routing SDK binds quotes to explicit approvals and reconciles source transactions and independently verified destination receipts. Its built-in destination verifier supports **NEAR and Base only**. Execution on additional chains requires an owner-operated source sender and a suitable destination receipt verifier; the broader browser catalogue does not establish all-chain execution or verification support.

See the [client SDK](../packages/client/README.md) and [owner-routing SDK](../packages/intents/README.md).
