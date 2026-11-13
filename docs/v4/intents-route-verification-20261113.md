# Intents route verification: dry-quote samples

Verified on **13 November 2026 (UTC)** against the real mainnet NEAR Intents 1Click API. Every request used **`dry: true`**. No funds were moved, transfers executed, or live deposit addresses requested.

ACH sampled selected catalogue assets against its NEAR USDC settlement asset. A funding quote goes from the selected asset to NEAR USDC; a payout quote goes in the reverse direction. These results verify quote interoperability with the ACH coordinator and SDK. They do not establish execution coverage, support for every asset on a chain, or support for every possible chain pair. Mainnet execution remains deferred.

## Results

The catalogue returned **230 assets across 39 chain IDs**. All 39 chains were sampled. Across the initial checks, focused retries and address-format checks, 162 dry-quote requests produced 106 validated quotes; the remaining attempts included provider rejections and a response rejected by strict amount matching.

| Observed result | Chain count | Scope |
| --- | ---: | --- |
| Valid quotes in both directions through the coordinator | **34** | **33 external chains plus NEAR**; at least one sampled asset per chain |
| Valid payout quotes only | **1** | Stellar: XLM and USDC payout succeeded; sampled funding pairs were unavailable |
| No successful sampled quote | **4** | Abstract, Miden, Movement and Pearl; reasons below |

The 34 chain IDs with valid quotes in both directions were:

`adi`, `aleo`, `aptos`, `arb`, `avax`, `base`, `bch`, `bera`, `bsc`, `btc`, `cardano`, `dash`, `doge`, `eth`, `fogo`, `gnosis`, `hood`, `hypercore`, `ltc`, `monad`, `near`, `op`, `plasma`, `pol`, `qtc`, `scroll`, `sol`, `starknet`, `sui`, `ton`, `tron`, `xlayer`, `xrp`, `zec`.

NEAR in that list represents quotes between NEAR assets and the NEAR USDC anchor. It is not an additional external chain. Catalogue availability and successful dry quotes are separate from executed transfers; route liquidity and bridge acceptance must be assessed for each request.

## Provider and route limits observed

| Chain or asset | Sample result |
| --- | --- |
| Abstract (`abs`), ETH | The provider rejected tested EVM recipient/refund addresses. The asset appeared in the catalogue, while the chain ID was absent from the published OpenAPI enum at the time checked. |
| Movement, MOVE and USDCx | No liquidity in either direction. MOVE also returned no liquidity at a smaller sample size. |
| Miden, WBTC / USDT / SOL / USDCX / ETH | No liquidity in either direction using address vectors based on the maintained official SDK tests, including routing-parameter variants. |
| Pearl (`prl`), PRL | No liquidity in either direction at approximately $15 or $125, using SDK-valid P2TR and P2MR formats. |
| Stellar | XLM and USDC payout quotes succeeded. Funding returned `Quoting for this pair is not available` in the required `MEMO` deposit mode. Trying `SIMPLE` explicitly returned `Incorrect depositMode for originAsset from stellar chain`. |
| Berachain | BERA funding succeeded, while BERA payout had no liquidity. USDT0 quoted successfully in both directions. |
| XLayer | USDC funding succeeded, while USDC payout had no liquidity. USDT0 and OKB quoted successfully in both directions. |
| Hypercore | HIP1 USDC quoted successfully in both directions with a compatible source precision. The ERC20 USDC asset supported payout but was explicitly rejected as an origin asset. |
| XRP and Stellar accounts | Some checksum-valid XRP addresses and a generated Stellar address produced provider internal errors. Using official treasury addresses produced XRP quotes in both directions and Stellar USDC payout. Those earlier failures were address/account-specific; they do not establish that the chains are unsupported. |

### Minimum amounts

The official [swap-limit documentation](https://docs.near-intents.org/resources/swap-limits.md) stated a **$1,000 BNB Chain minimum** for chain-to-chain swaps and a **$100 minimum when Tron is the origin**. A Tron input calculated fractionally below $100 was rejected; approximately $125 worked in both directions.

The sampled dry BNB quotes at approximately $100 nevertheless succeeded. Published policy and dry-quote enforcement therefore differed during these checks. A successful dry quote must not be treated as confirmation that a later transfer below a published minimum will execute.

### Source precision and response binding

For the eight-decimal Hypercore HIP1 USDC asset, the provider echoed the requested input amount but rounded its quoted `amountIn` from `100.04592108` to `100.04592100`. ACH rejected that response with `QUOTE_AMOUNT_MISMATCH`. Inputs aligned to six decimal places succeeded.

ACH retains strict amount and request-identity checks. The address-format improvements described below do not relax those checks or silently change the requested amount.

## Address-format verification

The following formats were accepted by the provider and are now supported by the coordinator:

- Dogecoin P2SH addresses beginning with `A`.
- Dash P2SH addresses beginning with `7`.
- Tron hex addresses beginning with `41`, normalized to the equivalent Base58Check address.
- Full Sui hex addresses without `0x`, normalized to lowercase with the prefix.
- Zcash TEX addresses beginning with `tex1`.
- Uppercase Bitcoin bech32 addresses, normalized to lowercase.

All **12 follow-up dry quotes** through the updated coordinator succeeded: both directions for each of these six forms, with local validation enabled. Canonical addresses are bound into the provider request before validating the response. The original user input remains the idempotency fingerprint.

Dogecoin P2SH forms beginning with `9` were rejected by the provider despite valid generated checksums. The maintained official SDK likewise accepts `D`/`A` and rejects `9`, although the older chain-support page listed `9`. ACH retains the observed `D`/`A` restriction.

The Intents service regression tests passed, including normalized identities in both directions, idempotent retries, malformed/unsupported inputs, and adversarial amount or identity substitution:

```sh
node --test --experimental-test-isolation=none services/test/intents.test.mjs
```

## Sources and interpretation

- [1Click OpenAPI](https://1click.chaindefuser.com/docs/v0/openapi.yaml)
- [Supported chains and address formats](https://docs.near-intents.org/resources/chain-support)
- [Swap limits](https://docs.near-intents.org/resources/swap-limits.md)
- [Maintained SDK address validator](https://github.com/defuse-protocol/sdk-monorepo/blob/main/packages/intents-sdk/src/lib/validateAddress.ts)
- [Official SDK address test vectors](https://github.com/defuse-protocol/sdk-monorepo/blob/main/packages/intents-sdk/src/lib/validateAddress.spec.ts)
- [Official treasury addresses](https://docs.near-intents.org/security-compliance/treasury-addresses.md)

This public report omits sample addresses and raw request/response bodies. Results are dated samples of dry-quote interoperability. They do not verify funding transactions, destination receipts, later liquidity, or production execution. Internal ACH clearing and netting remain anchored to the NEAR settlement asset.
