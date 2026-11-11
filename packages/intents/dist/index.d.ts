/** Intents operates at the edge of ACH. Quotes never credit the vault. */
export declare const INTENTS_STATUS: readonly ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"];
export type IntentsStatus = typeof INTENTS_STATUS[number];
export type RouteState = "QUOTED" | "WITHDRAWING" | "AWAITING_DEPOSIT" | "RECONCILING_SOURCE" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "AWAITING_RECEIPT" | "RECEIVED" | "REFUNDED" | "FAILED" | "EXPIRED";
export interface IntentsToken {
    assetId: string;
    decimals: number;
    blockchain: string;
    symbol: string;
    contractAddress?: string;
}
export interface QuoteRequest {
    dry: boolean;
    swapType: "EXACT_INPUT";
    slippageTolerance: number;
    originAsset: string;
    destinationAsset: string;
    amount: string;
    refundTo: string;
    recipient: string;
    deadline: string;
    depositType: "ORIGIN_CHAIN";
    refundType: "ORIGIN_CHAIN";
    recipientType: "DESTINATION_CHAIN";
    depositMode: "SIMPLE" | "MEMO";
}
export interface QuoteResponse {
    correlationId: string;
    quote: {
        depositAddress?: string;
        depositMemo?: string;
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        deadline?: string;
        timeEstimate: number;
    };
    quoteRequest?: QuoteRequest;
}
export interface StatusResponse {
    status: string;
    updatedAt: string;
    quoteResponse: QuoteResponse;
    swapDetails: {
        amountOut?: string;
        destinationChainTxHashes?: {
            hash: string;
            explorerUrl?: string;
        }[];
        originChainTxHashes?: {
            hash: string;
            explorerUrl?: string;
        }[];
        [key: string]: unknown;
    };
}
export interface DestinationReceipt {
    chain: string;
    asset: string;
    recipient: string;
    amount: string;
    tx_hash: string;
    confirmed: boolean;
}
export interface Route {
    id: string;
    request: QuoteRequest;
    response: QuoteResponse;
    state: RouteState;
    raw_status?: string;
    known_source_tx?: string;
    receipt?: DestinationReceipt;
    checked_at?: string;
    approval_hash?: string;
    destination_chain?: string;
}
export declare function validateQuoteRequest(r: QuoteRequest, now?: number): void;
export declare function assertQuoteMatches(request: QuoteRequest, response: QuoteResponse): void;
export declare function routeState(status: string): RouteState;
export declare function reconcileRoute(route: Route, status: StatusResponse, receipt?: DestinationReceipt): Route;
export declare class OneClickIntents {
    private readonly fetcher;
    private readonly apiKey?;
    constructor(fetcher?: typeof fetch, apiKey?: string | undefined);
    private request;
    tokens(): Promise<IntentsToken[]>;
    quote(request: QuoteRequest): Promise<QuoteResponse>;
    status(depositAddress: string, depositMemo?: string): Promise<StatusResponse>;
    submitKnownDeposit(depositAddress: string, txHash: string, depositMemo?: string): Promise<unknown>;
}
