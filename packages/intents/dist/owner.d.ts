import type { AchV4Client } from '@ach/client/v4';
import { OneClickIntents } from './index.js';
import type { Route, QuoteRequest, DestinationReceipt, IntentsToken, StatusResponse } from './index.js';
export interface OwnerRoute extends Route {
    network: 'mainnet';
    vault: string;
    owner_id: string;
    kind: 'funding' | 'payout';
    source_chain: string;
    destination_chain: string;
    approval_hash: string;
    withdrawal_id?: string;
    deposit_id?: string;
    source_submission_recorded?: boolean;
    deposit_confirmed?: boolean;
    deposit_tx?: string;
}
export interface RouteStore {
    get(id: string): Promise<OwnerRoute | undefined>;
    put(route: OwnerRoute): Promise<void>;
}
/** The sender retains its key and must journal its signed transaction before broadcast. */
export interface SourceSender {
    account_id: string;
    asset_id: string;
    sendExactQuote(route: OwnerRoute, operationId: string): Promise<{
        tx_hash: string;
        confirmed: boolean;
    }>;
}
export type ReceiptVerifier = (route: OwnerRoute, status: StatusResponse) => Promise<DestinationReceipt | undefined>;
export declare function ownerRouteHash(route: Omit<OwnerRoute, 'approval_hash'>): string;
/** Mainnet-only routing. Testnet balances never enter this class. */
export declare class OwnerIntentsRouter {
    private readonly ach;
    private readonly api;
    private readonly store;
    private readonly verifyReceipt;
    private readonly clock;
    constructor(ach: AchV4Client, api: OneClickIntents, store: RouteStore, verifyReceipt: ReceiptVerifier, clock?: () => number);
    private record;
    prepare(id: string, kind: 'funding' | 'payout', request: QuoteRequest): Promise<OwnerRoute>;
    execute(id: string, approvedHash: string, sender: SourceSender): Promise<OwnerRoute>;
    refresh(id: string): Promise<OwnerRoute>;
    depositReceivedFunding(id: string): Promise<OwnerRoute>;
}
/** NEAR NEP-141 source leg with the owner's durable, signer-backed transport. */
export declare class NearTokenRouteSender implements SourceSender {
    private readonly ach;
    readonly account_id: string;
    readonly asset_id: string;
    constructor(ach: AchV4Client);
    sendExactQuote(route: OwnerRoute, operationId: string): Promise<{
        tx_hash: string;
        confirmed: boolean;
    }>;
}
/** Receipt data comes from an independently configured chain RPC, never browser input. */
export declare function destinationReceiptVerifier(tokens: IntentsToken[], options: {
    nearRpc: string;
    baseRpc: string;
    baseConfirmations?: number;
    fetcher?: typeof fetch;
}): ReceiptVerifier;
