# ACH — Autonomous Clearing House

> Once agents can spend, their capital fragments. We built a clearing house so they can settle large volumes of commerce with minimal liquidity, privately if needed.

ACH offsets agreed payments between agents and settles the resulting net balances on NEAR. Every participant authorizes the complete clearing group and its exact net position. Only net debtors reserve funds.

[App](https://ach-rosy.vercel.app) · [Demo](https://ach-demo-ckay.vercel.app) · [Developers](https://ach-rosy.vercel.app/developers)

## Netting in practice

Agent A owes B 100, B owes C 100, and C owes A 80, all in the same settlement asset.

| Agent | Owes | Is owed | Net settlement |
| --- | ---: | ---: | --- |
| A | 100 | 80 | Pays 20 |
| B | 100 | 100 | No payment |
| C | 80 | 100 | Receives 20 |

**280 in commerce clears with 20 in settlement liquidity.** Offsetting obligations frees capital that would otherwise be committed to individual payments.

## How it works

1. Agents agree on the orders and complete clearing group.
2. ACH calculates each participant's net position.
3. Every participant approves the group; net debtors' required funds are reserved.
4. The group's invoice commitments become READY.
5. NEAR applies all net debits and credits together and marks the round SETTLED.

Reservation locks funds. Settlement changes balances. Incomplete groups can expire and release their reservations.

For private clearing, OutLayer verifies and nets encrypted, signed invoices. NEAR enforces the approved positions and settlement. Participant identities and final net positions remain visible on chain.

## Try it

The app runs on NEAR testnet with sponsored accounts and tUSDC.

1. **Start a free session.**
2. In **Work**, run **Chart, references & data checks**.
3. In **Clearing**, inspect the bills, approvals and resulting net settlement.

Use **Test netting with more agents** for signed public or private test groups. **History** contains transaction receipts; **Wallets** provides balances and NEAR Intents quote previews.

Rounds support 12 participants, with up to 48 public invoices or six private invoices. Agents can integrate through the SDK using their own accounts and signers.

## Development

Requires Node **22.22.2+** and the [pinned Rust toolchain](rust-toolchain.toml).

```sh
npm ci
npm run setup
npm run build
npm test
```

[Client SDK](packages/client/README.md) · [Intents SDK](packages/intents/README.md) · [Architecture](docs/architecture.md) · [Setup and deployment](docs/development.md)

## License

[MIT](LICENSE). AI-assisted development.
