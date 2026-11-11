/**
 * ACH — typed client for the clearing contract on NEAR.
 *
 * Works with near-api-js v7. Views are public; calls require a signer
 * (a KeyPairString for server-side use, or a wallet-backed signer in the
 * browser).
 */
import { JsonRpcProvider } from "near-api-js";
import type { Signer, KeyPairString } from "near-api-js";
export * from "./v4.js";
export { YOCTO_PER_NEAR, nearToYocto, formatNear, requiredCollateral, } from "./amounts.js";
export declare const DEFAULT_RPC_URL = "https://test.rpc.fastnear.com";
export declare const DEFAULT_CONTRACT_ID = "ach-clearing-v2.testnet";
export interface ParticipantProfile {
    accountId: string;
    name: string;
    kind: string;
    bio: string;
    icon: string;
    createdAt: number;
}
export interface ObligationDTO {
    id: string;
    debtor: string;
    creditor: string;
    amount: string;
    memo: string;
    createdAt: number;
    dueAt: number | null;
    status: "pending" | "open" | "disputed" | "settled" | "voided";
    disputedBy?: string;
    proposer?: string;
    debtorApproved?: boolean;
    creditorApproved?: boolean;
    funded?: boolean;
    legacyReview?: boolean;
    debtorResolution?: "keep" | "void";
    creditorResolution?: "keep" | "void";
}
export interface SecurityConfig {
    version: number;
    ready: boolean;
    bilateralApproval: boolean;
    strictDueTimes: boolean;
    reservedCollateral: boolean;
    bilateralDisputes: boolean;
    registrationDeposit: string;
    proposalDeposit: string;
    withdrawalDeposit: string;
    legacyReviewRequired?: number | null;
    migrationCursor?: number;
    migrationTotal?: number;
}
export interface AvailableBalance {
    accountId: string;
    balance: string;
    reservedCollateral: string;
    reservedPayable: string;
    availableBalance: string;
    withdrawalsEnabled: boolean;
}
export interface ClearPreview extends ClearingResultDTO {
    shortfalls: string[];
    ready: boolean;
    remaining: number;
}
export interface TransferDTO {
    from: string;
    to: string;
    amount: string;
}
export interface ClearingResultDTO {
    positions: {
        accountId: string;
        net: string;
    }[];
    transfers: TransferDTO[];
    grossVolume: string;
    netVolume: string;
    compression: number;
    obligationCount: number;
    obligationIds: string[];
}
export interface SettlementDTO {
    id: string;
    timestamp: number;
    grossVolume: string;
    netVolume: string;
    compression: number;
    obligationCount: number;
    obligationIds: string[];
    transfers: TransferDTO[];
}
export interface StatsDTO {
    ownerId: string;
    participantCount: number;
    obligationCount: number;
    openObligations: number;
    pendingObligations?: number;
    disputedObligations?: number;
    securityVersion?: number;
    securityReady?: boolean;
    settlementCount: number;
    totalSettledVolume: string;
}
export interface ClearResult {
    roundId: string;
    remaining?: number;
    transfers: TransferDTO[];
    grossVolume: string;
    netVolume: string;
    compression: number;
    obligationCount: number;
}
export interface RiskRow {
    accountId: string;
    name: string;
    balance: string;
    creditLimit: string;
    grossPayable: string;
    grossReceivable: string;
    netPosition: string;
    collateralRequired: string;
    covered: boolean;
    reservedPayable?: string;
    availableBalance?: string;
    pendingPayable?: string;
    pendingReceivable?: string;
    withdrawalsEnabled?: boolean;
    securityVersion?: number;
}
export interface StatementDTO {
    accountId: string;
    name: string;
    kind: string;
    balance: string;
    creditLimit: string;
    grossPayable: string;
    grossReceivable: string;
    netPosition: string;
    openIncoming: ObligationDTO[];
    openOutgoing: ObligationDTO[];
    pendingIncoming?: ObligationDTO[];
    pendingOutgoing?: ObligationDTO[];
    reservedCollateral?: string;
    reservedPayable?: string;
    availableBalance?: string;
    withdrawalsEnabled?: boolean;
    securityVersion?: number;
    settlements: {
        id: string;
        timestamp: number;
        netVolume: string;
        compression: number;
        transfers: TransferDTO[];
    }[];
}
export interface ClearingClientOptions {
    contractId?: string;
    rpcUrl?: string;
    /** KeyPairString or Signer for signing calls (server-side). */
    signer?: KeyPairString | Signer;
    /** The account id that owns `signer` (required when signer is a KeyPairString). */
    signerAccountId?: string;
}
export declare class ClearingClient {
    readonly contractId: string;
    readonly provider: JsonRpcProvider;
    private account;
    private securitySnapshot;
    constructor(opts?: ClearingClientOptions);
    /** Attach a signer later (e.g. after wallet login). */
    withSigner(signer: KeyPairString | Signer, accountId: string): ClearingClient;
    private view;
    private static GAS;
    private call;
    getParticipants(): Promise<ParticipantProfile[]>;
    getParticipant(accountId: string): Promise<ParticipantProfile | null>;
    getBalance(accountId: string): Promise<string>;
    getSecurityConfig(): Promise<SecurityConfig>;
    getAvailableBalance(accountId: string): Promise<AvailableBalance>;
    getClearingObligations(): Promise<ObligationDTO[]>;
    getObligation(obligationId: string): Promise<ObligationDTO | null>;
    previewClear(maxObligations?: number, obligationIds?: string[]): Promise<ClearPreview | null>;
    getObligations(filter?: {
        status?: string;
        account_id?: string;
        limit?: number;
        start?: number;
    }): Promise<ObligationDTO[]>;
    getSettlements(limit?: number): Promise<SettlementDTO[]>;
    getStats(): Promise<StatsDTO>;
    computeNetPositions(includeNotDue?: boolean): Promise<ClearingResultDTO>;
    private exposureSnapshot;
    getRisk(): Promise<RiskRow[]>;
    /** Large-history fallback includes transfers across the latest 200 rounds. */
    getStatement(accountId: string): Promise<StatementDTO>;
    getCreditLimits(): Promise<{
        accountId: string;
        creditLimit: string;
    }[]>;
    getCollateralRatio(): Promise<number>;
    join(profile: {
        name: string;
        kind: string;
        bio: string;
        icon: string;
    }): Promise<void>;
    deposit(amountYocto: string): Promise<void>;
    withdraw(amountYocto: string): Promise<void>;
    recordObligation(args: {
        debtor: string;
        creditor: string;
        amount: string;
        memo: string;
        dueAt?: number | null;
    }): Promise<string>;
    acceptObligation(obligationId: string): Promise<ObligationDTO>;
    fundObligation(obligationId: string): Promise<ObligationDTO>;
    rejectObligation(obligationId: string): Promise<ObligationDTO>;
    dispute(obligationId: string): Promise<void>;
    resolveDispute(obligationId: string, outcome: "keep" | "void"): Promise<void>;
    clear(includeNotDue?: boolean, maxObligations?: number, obligationIds?: string[]): Promise<ClearResult>;
    setCreditLimit(accountId: string, limitYocto: string): Promise<void>;
    setCollateralRatio(ratio: number): Promise<void>;
}
