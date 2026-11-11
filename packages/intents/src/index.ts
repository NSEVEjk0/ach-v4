/** Intents operates at the edge of ACH. Quotes never credit the vault. */
export const INTENTS_STATUS = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
export type IntentsStatus = typeof INTENTS_STATUS[number];
export type RouteState = "QUOTED" | "WITHDRAWING" | "AWAITING_DEPOSIT" | "RECONCILING_SOURCE" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "AWAITING_RECEIPT" | "RECEIVED" | "REFUNDED" | "FAILED" | "EXPIRED";
export interface IntentsToken { assetId: string; decimals: number; blockchain: string; symbol: string; contractAddress?: string }
export interface QuoteRequest {
  dry: boolean; swapType: "EXACT_INPUT"; slippageTolerance: number; originAsset: string;
  destinationAsset: string; amount: string; refundTo: string; recipient: string; deadline: string;
  depositType: "ORIGIN_CHAIN"; refundType: "ORIGIN_CHAIN"; recipientType: "DESTINATION_CHAIN";
  depositMode: "SIMPLE" | "MEMO";
}
export interface QuoteResponse { correlationId: string; quote: { depositAddress?: string; depositMemo?: string; amountIn: string; amountOut: string; minAmountOut: string; deadline?: string; timeEstimate: number }; quoteRequest?: QuoteRequest }
export interface StatusResponse { status: string; updatedAt: string; quoteResponse: QuoteResponse; swapDetails: { amountOut?: string; destinationChainTxHashes?: { hash: string; explorerUrl?: string }[]; originChainTxHashes?: { hash: string; explorerUrl?: string }[]; [key: string]: unknown } }
export interface DestinationReceipt { chain: string; asset: string; recipient: string; amount: string; tx_hash: string; confirmed: boolean }
export interface Route {
  id: string; request: QuoteRequest; response: QuoteResponse; state: RouteState; raw_status?: string;
  known_source_tx?: string; receipt?: DestinationReceipt; checked_at?: string; approval_hash?: string; destination_chain?: string;
}
const units = (s: string) => { if (!/^(0|[1-9]\d*)$/.test(s) || s.length > 78) throw new Error("INVALID_ROUTE_AMOUNT"); return BigInt(s); };
export function validateQuoteRequest(r: QuoteRequest, now = Date.now()): void {
  if (typeof r.dry !== "boolean" || !["SIMPLE", "MEMO"].includes(r.depositMode)) throw new Error("UNSUPPORTED_ROUTE_MODE");
  if (!r.originAsset.startsWith("nep141:") || !r.destinationAsset.startsWith("nep141:") || r.originAsset === r.destinationAsset) throw new Error("INVALID_ROUTE_ASSET");
  if (!units(r.amount) || !r.recipient || !r.refundTo || r.recipient.length > 128 || r.refundTo.length > 128) throw new Error("INVALID_ROUTE_IDENTITY");
  if (r.depositType !== "ORIGIN_CHAIN" || r.refundType !== "ORIGIN_CHAIN" || r.recipientType !== "DESTINATION_CHAIN" || r.swapType !== "EXACT_INPUT") throw new Error("UNSUPPORTED_ROUTE_MODE");
  if (!Number.isInteger(r.slippageTolerance) || r.slippageTolerance < 0 || r.slippageTolerance > 300) throw new Error("SLIPPAGE_LIMIT");
  const expiry = Date.parse(r.deadline); if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 2 * 60 * 60 * 1000) throw new Error("INVALID_QUOTE_DEADLINE");
}
export function assertQuoteMatches(request: QuoteRequest, response: QuoteResponse): void {
  units(response.quote.amountIn); units(response.quote.amountOut); units(response.quote.minAmountOut);
  if (!response.correlationId || response.quote.amountIn !== request.amount || units(response.quote.minAmountOut) === 0n || units(response.quote.minAmountOut) > units(response.quote.amountOut)) throw new Error("QUOTE_AMOUNT_MISMATCH");
  if (!response.quoteRequest) throw new Error("QUOTE_IDENTITY_MISMATCH");
  if (response.quoteRequest) {
    for (const field of ["dry", "originAsset", "destinationAsset", "recipient", "refundTo", "amount", "swapType", "depositType", "recipientType", "refundType", "depositMode", "slippageTolerance", "deadline"] as const) if (response.quoteRequest[field] !== request[field]) throw new Error("QUOTE_IDENTITY_MISMATCH");
  }
  if (request.dry && response.quote.depositAddress) throw new Error("DRY_QUOTE_DEPOSIT_REFUSED");
  if (!request.dry && (!response.quote.depositAddress || !response.quote.deadline)) throw new Error("INCOMPLETE_LIVE_QUOTE");
  if (!request.dry && (!Number.isFinite(Date.parse(response.quote.deadline!)) || Date.parse(response.quote.deadline!) > Date.parse(request.deadline))) throw new Error("QUOTE_DEADLINE_MISMATCH");
}
export function routeState(status: string): RouteState {
  switch (status) {
    case "KNOWN_DEPOSIT_TX": return "RECONCILING_SOURCE";
    case "PENDING_DEPOSIT": return "AWAITING_DEPOSIT";
    case "INCOMPLETE_DEPOSIT": return "INCOMPLETE_DEPOSIT";
    case "PROCESSING": return "PROCESSING";
    case "SUCCESS": return "AWAITING_RECEIPT";
    case "REFUNDED": return "REFUNDED";
    case "FAILED": return "FAILED";
    default: return "RECONCILING_SOURCE";
  }
}
export function reconcileRoute(route: Route, status: StatusResponse, receipt?: DestinationReceipt): Route {
  const quoted = route.response.quote;
  if (status.quoteResponse.quote.depositAddress !== quoted.depositAddress || status.quoteResponse.quote.depositMemo !== quoted.depositMemo) throw new Error("ROUTE_STATUS_IDENTITY_MISMATCH");
  assertQuoteMatches(route.request, status.quoteResponse);
  const next: Route = { ...route, raw_status: status.status, state: routeState(status.status), checked_at: status.updatedAt };
  if (route.state === "RECEIVED" || route.state === "REFUNDED") {
    if (status.status !== (route.state === "RECEIVED" ? "SUCCESS" : "REFUNDED")) throw new Error("TERMINAL_ROUTE_STATE_CONFLICT");
    return route;
  }
  if (status.status === "SUCCESS" && receipt) {
    if (!route.destination_chain || receipt.chain !== route.destination_chain || !receipt.confirmed || !receipt.tx_hash || receipt.recipient !== route.request.recipient || receipt.asset !== route.request.destinationAsset || units(receipt.amount) < units(quoted.minAmountOut)) throw new Error("DESTINATION_RECEIPT_MISMATCH");
    const txs = status.swapDetails.destinationChainTxHashes;
    if (!txs?.some(tx => tx.hash === receipt.tx_hash)) throw new Error("DESTINATION_TRANSACTION_MISMATCH");
    next.state = "RECEIVED"; next.receipt = receipt;
  }
  return next;
}
export class OneClickIntents {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly apiKey?: string) {}
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`https://1click.chaindefuser.com/v0/${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`INTENTS_API_${response.status}`); return response.json() as Promise<T>;
  }
  tokens() { return this.request<IntentsToken[]>("tokens"); }
  async quote(request: QuoteRequest): Promise<QuoteResponse> { validateQuoteRequest(request); const quote = await this.request<QuoteResponse>("quote", request); assertQuoteMatches(request, quote); return quote; }
  status(depositAddress: string, depositMemo?: string) { const params = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) }); return this.request<StatusResponse>(`status?${params}`); }
  submitKnownDeposit(depositAddress: string, txHash: string, depositMemo?: string) { return this.request("deposit/submit", { depositAddress, txHash, ...(depositMemo ? { depositMemo } : {}) }); }
}
