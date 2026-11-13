/** Intents operates at the edge of ACH. Quotes never credit the vault. */
import { routeJson } from './http.js';
export const INTENTS_STATUS = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"];
const units = (s) => { if (!/^(0|[1-9]\d*)$/.test(s) || s.length > 78)
    throw new Error("INVALID_ROUTE_AMOUNT"); return BigInt(s); };
/** Catalogue identifiers cover NEP-141, NEP-245 and Chain Signatures assets. */
export function isIntentsAssetId(value) {
    return typeof value === 'string' && /^(?:nep141|nep245|1cs_v1):[^\s\u0000-\u001f\u007f]{1,244}$/.test(value);
}
export function validateQuoteRequest(r, now = Date.now()) {
    if (typeof r.dry !== "boolean" || !["SIMPLE", "MEMO"].includes(r.depositMode))
        throw new Error("UNSUPPORTED_ROUTE_MODE");
    if (!isIntentsAssetId(r.originAsset) || !isIntentsAssetId(r.destinationAsset) || r.originAsset === r.destinationAsset)
        throw new Error("INVALID_ROUTE_ASSET");
    if (!units(r.amount) || ![r.recipient, r.refundTo].every(value => typeof value === 'string' && value.length >= 2 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(value)))
        throw new Error("INVALID_ROUTE_IDENTITY");
    if (r.depositType !== "ORIGIN_CHAIN" || r.refundType !== "ORIGIN_CHAIN" || r.recipientType !== "DESTINATION_CHAIN" || r.swapType !== "EXACT_INPUT")
        throw new Error("UNSUPPORTED_ROUTE_MODE");
    if (!Number.isInteger(r.slippageTolerance) || r.slippageTolerance < 0 || r.slippageTolerance > 300)
        throw new Error("SLIPPAGE_LIMIT");
    const expiry = Date.parse(r.deadline);
    if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 2 * 60 * 60 * 1000)
        throw new Error("INVALID_QUOTE_DEADLINE");
}
export function assertQuoteMatches(request, response) {
    units(response.quote.amountIn);
    units(response.quote.amountOut);
    units(response.quote.minAmountOut);
    if (!response.correlationId || response.quote.amountIn !== request.amount || units(response.quote.minAmountOut) === 0n || units(response.quote.minAmountOut) > units(response.quote.amountOut))
        throw new Error("QUOTE_AMOUNT_MISMATCH");
    if (!response.quoteRequest)
        throw new Error("QUOTE_IDENTITY_MISMATCH");
    if (response.quoteRequest) {
        for (const field of ["dry", "originAsset", "destinationAsset", "recipient", "refundTo", "amount", "swapType", "depositType", "recipientType", "refundType", "depositMode", "slippageTolerance", "deadline"])
            if (response.quoteRequest[field] !== request[field])
                throw new Error("QUOTE_IDENTITY_MISMATCH");
    }
    if (request.dry && response.quote.depositAddress)
        throw new Error("DRY_QUOTE_DEPOSIT_REFUSED");
    if (!request.dry && (!response.quote.depositAddress || !response.quote.deadline))
        throw new Error("INCOMPLETE_LIVE_QUOTE");
    if (!request.dry && (!Number.isFinite(Date.parse(response.quote.deadline)) || Date.parse(response.quote.deadline) > Date.parse(request.deadline)))
        throw new Error("QUOTE_DEADLINE_MISMATCH");
    if (request.depositMode === 'SIMPLE' && response.quote.depositMemo || !request.dry && request.depositMode === 'MEMO' && !response.quote.depositMemo)
        throw new Error('QUOTE_DEPOSIT_MODE_MISMATCH');
}
export function routeState(status) {
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
export function reconcileRoute(route, status, receipt) {
    const quoted = route.response.quote;
    if (status.quoteResponse.correlationId !== route.response.correlationId || ["depositAddress", "depositMemo", "amountIn", "amountOut", "minAmountOut", "deadline"].some(field => status.quoteResponse.quote[field] !== quoted[field]))
        throw new Error("ROUTE_STATUS_IDENTITY_MISMATCH");
    assertQuoteMatches(route.request, status.quoteResponse);
    const next = { ...route, raw_status: status.status, state: routeState(status.status), checked_at: status.updatedAt };
    if (route.state === "RECEIVED" || route.state === "REFUNDED") {
        if (status.status !== (route.state === "RECEIVED" ? "SUCCESS" : "REFUNDED"))
            throw new Error("TERMINAL_ROUTE_STATE_CONFLICT");
        return route;
    }
    if (route.state === 'FAILED' && !['FAILED', 'REFUNDED'].includes(status.status))
        throw new Error('TERMINAL_ROUTE_STATE_CONFLICT');
    if (status.status === "SUCCESS" && receipt) {
        if (!route.destination_chain || receipt.chain !== route.destination_chain || !receipt.confirmed || !receipt.tx_hash || receipt.recipient !== route.request.recipient || receipt.asset !== route.request.destinationAsset || units(receipt.amount) < units(quoted.minAmountOut))
            throw new Error("DESTINATION_RECEIPT_MISMATCH");
        const txs = status.swapDetails.destinationChainTxHashes;
        if (!txs?.some(tx => tx.hash === receipt.tx_hash))
            throw new Error("DESTINATION_TRANSACTION_MISMATCH");
        next.state = "RECEIVED";
        next.receipt = receipt;
    }
    return next;
}
export class OneClickIntents {
    fetcher;
    apiKey;
    constructor(fetcher = fetch, apiKey) {
        this.fetcher = fetcher;
        this.apiKey = apiKey;
    }
    async request(path, body) {
        const response = await this.fetcher(`https://1click.chaindefuser.com/v0/${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20_000) });
        if (!response.ok)
            throw new Error(`INTENTS_API_${response.status}`);
        return routeJson(response);
    }
    tokens() { return this.request("tokens"); }
    async quote(request) { validateQuoteRequest(request); const quote = await this.request("quote", request); assertQuoteMatches(request, quote); return quote; }
    status(depositAddress, depositMemo) { const params = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) }); return this.request(`status?${params}`); }
    submitKnownDeposit(depositAddress, txHash, depositMemo) { return this.request("deposit/submit", { depositAddress, txHash, ...(depositMemo ? { depositMemo } : {}) }); }
}
