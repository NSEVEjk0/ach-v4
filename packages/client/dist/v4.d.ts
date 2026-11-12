import { Account, JsonRpcProvider } from "near-api-js";
import type { Signer, KeyPairString } from "near-api-js";
export type V4Units = string;
export type V4RoundState = "COLLECTING" | "READY" | "SETTLED" | "CANCELLED" | "EXPIRED" | "STALE";
export interface V4Deployment {
    protocol_version: 4;
    network: "testnet" | "mainnet";
    vault: string;
    token: string;
    decimals: 6;
    rpc_url: string;
    rpc_urls?: string[];
    code_hash?: string;
    workflow_revision?: 2;
}
export interface V4InvoiceSpec {
    id: string;
    purchase_id: string;
    terms_version: number;
    buyer: string;
    seller: string;
    asset: string;
    amount: V4Units;
    service: string;
    terms_hash: string;
    artifact_hash: string;
    ready_at_ms: number;
    expires_at_ms: number;
}
export interface V4Acceptance {
    owner: boolean;
    epoch: number;
    key: string;
    budget_charge: V4Units;
}
export interface V4Invoice {
    spec: V4InvoiceSpec;
    hash: string;
    charge_id: string;
    status: "PROPOSED" | "ACCEPTED" | "READY" | "SETTLED" | "CANCELLED";
    buyer_acceptance: V4Acceptance | null;
    seller_acceptance: V4Acceptance | null;
    round_id: string | null;
    sequence: number;
    funding_group_id?: string | null;
}
export interface V4Position {
    account_id: string;
    net: V4Units;
}
export interface V4FundingOrder {
    purchase_id: string;
    terms_version: number;
    buyer: string;
    seller: string;
    order_commitment: string;
    public_terms: {
        amount: V4Units;
        service: string;
        terms_hash: string;
        artifact_hash: string;
    } | null;
}
export interface V4FundingGroupInput {
    id: string;
    orders: V4FundingOrder[];
    positions: V4Position[];
    deadline_ms: number;
    private: boolean;
}
export interface V4FundingGroup {
    input: V4FundingGroupInput;
    hash: string;
    proposer: string;
    status: "COLLECTING" | "FUNDED" | "READY" | "SETTLED" | "EXPIRED";
    approvals: V4Approval[];
    round_id: string | null;
}
export interface V4RoundInput {
    id: string;
    invoice_ids: string[];
    invoice_hashes: string[];
    positions: V4Position[];
    deadline_ms: number;
    private: boolean;
    input_commitment: string;
    worker_hash: string;
}
export interface V4Approval {
    account_id: string;
    expected_net: V4Units;
    authority: V4Acceptance;
    required: V4Units;
    approved_at_ms: number;
}
export interface V4Round {
    input: V4RoundInput;
    hash: string;
    proposer: string;
    status: V4RoundState;
    approvals: V4Approval[];
    gross_invoice_volume: V4Units | null;
    net_settlement_volume: V4Units;
    created_at_ms: number;
    ready_at_ms: number | null;
    settled_at_ms: number | null;
    sequence: number;
    reason: string | null;
}
export interface V4Policy {
    key: string;
    epoch: number;
    max_invoice: V4Units;
    gross_budget: V4Units;
    max_net_commitment: V4Units;
    expires_at_ms: number;
    counterparties: string[];
    services: string[];
    revoked: boolean;
}
export interface V4Balance {
    account_id: string;
    name: string;
    balance: V4Units;
    reserved: V4Units;
    available: V4Units;
    pending_withdrawals: V4Units;
    policy: V4Policy | null;
    gross_purchase_budget_used: V4Units;
    active_proposals: number;
    active_authorizations: number;
    activity_count?: number;
    sponsored_records?: number;
}
export interface V4Withdrawal {
    id: string;
    account_id: string;
    receiver_id: string;
    amount: V4Units;
    status: "PENDING" | "COMPLETED" | "RESTORED";
    requested_at_ms: number;
    completed_at_ms: number | null;
}
export interface V4PrivateSignature {
    account_id: string;
    key_epoch: number;
    signature: string;
}
export interface V4PrivateContribution {
    spec: V4InvoiceSpec;
    salt: string;
    signatures: V4PrivateSignature[];
}
export interface V4PrivatePurchaseAuthorization {
    charge_id: string;
    purchase_id: string;
    terms_version: number;
    buyer: string;
    seller: string;
    order_commitment: string;
    policy_epoch: number;
    budget_charge: V4Units;
    status: "AUTHORIZED" | "FINALIZED" | "CANCELLED";
    buyer_cancelled?: boolean;
    seller_cancelled?: boolean;
    expires_at_ms?: number;
    funding_group_id?: string | null;
}
export interface V4EncryptedInvoice {
    nullifier: string;
    commitment: string;
    ephemeral_public_key: string;
    nonce: string;
    ciphertext: string;
}
export interface V4EncryptionKey {
    protocol_version: 4;
    worker_hash: string;
    public_key: string;
    algorithm: "X25519-HKDF-SHA256-AES-256-GCM";
}
export interface V4PrivateRoundRequest {
    id: string;
    profile: string;
    members: string[];
    deadline_ms: number;
    encrypted_invoices: V4EncryptedInvoice[];
    verification_only?: boolean;
    disclosure_signatures?: V4PrivateSignature[];
    funding_group_id?: string;
}
export interface V4Page<T> {
    items: T[];
    next_cursor: number | null;
    total: number;
}
export interface V4Confirmed<T> {
    value: T;
    tx_hash: string;
    evidence: "near_final" | "local_wasm";
    gas_burnt?: string;
    tokens_burnt?: string;
}
export interface V4CallOptions {
    operation_id: string;
    deposit?: bigint;
    gas?: bigint;
}
export interface V4Transport {
    readonly account_id: string;
    codeHash?(contract: string): Promise<string>;
    view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T>;
    call<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>>;
    /** Read an already journaled operation without signing or broadcasting. */
    reconcile?<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>>;
}
export interface V4Operation {
    id: string;
    payload_hash: string;
    signer_id: string;
    tx_hash: string;
    signed_transaction: string;
    state: "SIGNED" | "UNKNOWN" | "CONFIRMED" | "FAILED";
    created_at_ms?: number;
    amount?: V4Units;
    result?: V4Confirmed<unknown>;
    error?: string;
}
export interface V4Journal {
    get(id: string): Promise<V4Operation | undefined>;
    put(operation: V4Operation): Promise<void>;
}
export declare class V4MemoryJournal implements V4Journal {
    private readonly operations;
    get(id: string): Promise<V4Operation | undefined>;
    put(op: V4Operation): Promise<void>;
}
export declare const V4_MAX_AMOUNT: bigint;
export declare const V4_MAX_PRIVATE_INVOICES = 6;
export declare const V4_PRIVATE_INVOICE_PADDING_BYTES = 2048;
export declare function v4Units(value: string): bigint;
export declare function parseTestUSD(value: string): V4Units;
export declare function formatTestUSD(units: V4Units, minimumDecimals?: number): string;
export declare function validateV4Deployment(c: V4Deployment): V4Deployment;
export declare function v4Digest(bytes: Uint8Array | string): string;
export declare function canonicalV4(purpose: string, network: string, vault: string, fields: string[]): Uint8Array;
export declare function canonicalV4Invoice(c: V4Deployment, i: V4InvoiceSpec): Uint8Array;
export declare function v4InvoiceHash(c: V4Deployment, i: V4InvoiceSpec): string;
export declare function v4ChargeId(c: V4Deployment, i: Pick<V4InvoiceSpec, "buyer" | "purchase_id" | "terms_version">): string;
export declare function v4FundedInvoiceId(c: V4Deployment, order: Pick<V4InvoiceSpec, "buyer" | "purchase_id" | "terms_version">): string;
export declare function v4PurchaseGroupId(c: V4Deployment, proposer: string, requestId: string): string;
export declare function v4FundingGroupHash(c: V4Deployment, input: V4FundingGroupInput): string;
export declare function v4PrivateInvoiceCommitment(c: V4Deployment, spec: V4InvoiceSpec, salt: string): string;
export declare function v4PrivateInputCommitment(c: V4Deployment, requestId: string, deadline: number, workerHash: string, envelopes: V4EncryptedInvoice[]): string;
export declare function v4PrivateDisclosureHash(c: V4Deployment, inputCommitment: string, members: string[]): string;
export declare function encryptV4Invoice(c: V4Deployment, key: V4EncryptionKey, contribution: V4PrivateContribution): V4EncryptedInvoice;
export declare function v4NetPlan(invoices: V4InvoiceSpec[]): {
    positions: {
        account_id: string;
        net: string;
    }[];
    gross_invoice_volume: string;
    net_settlement_volume: string;
    settlement_ratio: number;
    volume_reduction: number;
};
export declare function v4RoundHash(c: V4Deployment, r: V4RoundInput): string;
export declare function verifyV4InvoiceSignature(keyHex: string, hashHex: string, signatureBase64: string): boolean;
export declare class V4BroadcastUnknown extends Error {
    readonly operation_id: string;
    readonly tx_hash: string;
    constructor(operation_id: string, tx_hash: string);
}
export declare function v4UnknownTransaction(error: unknown): boolean;
/** Retry transport failures with the same RPC payload. Contract errors are final. */
export declare class V4RpcProvider extends JsonRpcProvider {
    private connections;
    constructor(urls: string | readonly string[]);
    sendJsonRpc: JsonRpcProvider['sendJsonRpc'];
}
export declare function withV4SignerLock<T>(account: Account, task: () => Promise<T>): Promise<T>;
export declare class V4NearTransport implements V4Transport {
    readonly account_id: string;
    private journal;
    readonly provider: JsonRpcProvider;
    readonly account: Account;
    constructor(account_id: string, rpc: string | readonly string[], signer: Signer | KeyPairString, journal: V4Journal);
    codeHash(contract: string): Promise<string>;
    view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T>;
    call<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>>;
    reconcile<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>>;
    private submit;
    private confirm;
}
export declare class AchV4Client {
    readonly transport: V4Transport;
    private role;
    readonly deployment: V4Deployment;
    private validated;
    constructor(config: V4Deployment, transport: V4Transport, role?: "owner" | "agent");
    assertDeployment(refresh?: boolean): Promise<void>;
    private read;
    private write;
    register(name: string, requestId?: string): Promise<V4Confirmed<V4Balance>>;
    sponsorAccount(account_id: string, name: string, expires_at_ms: number, requestId: string): Promise<V4Confirmed<unknown>>;
    setPolicy(policy: Omit<V4Policy, "epoch" | "revoked">, requestId: string): Promise<V4Confirmed<V4Policy>>;
    revokeAgent(requestId: string): Promise<V4Confirmed<V4Policy>>;
    balance(account_id?: string): Promise<V4Balance>;
    invoice(id: string): Promise<V4Invoice>;
    round(id: string): Promise<V4Round>;
    purchaseGroup(id: string): Promise<V4FundingGroup>;
    purchaseOrder(id: string): Promise<{
        group_id: string;
        order: V4FundingOrder;
        status: string;
        invoice_id: string | null;
    } | null>;
    proposePurchaseGroup(input: V4FundingGroupInput): Promise<V4Confirmed<V4FundingGroup>>;
    authorizePurchaseGroup(group: V4FundingGroup, expected_net: string): Promise<V4Confirmed<V4FundingGroup>>;
    expirePurchaseGroup(id: string): Promise<V4Confirmed<V4FundingGroup>>;
    proposeInvoice(spec: V4InvoiceSpec): Promise<V4Confirmed<V4Invoice>>;
    acceptInvoice(invoice: V4Invoice): Promise<V4Confirmed<V4Invoice>>;
    cancelInvoice(invoice: V4Invoice): Promise<V4Confirmed<V4Invoice>>;
    proposeRound(id: string, invoice_ids: string[], deadline_ms: number): Promise<V4Confirmed<V4Round>>;
    authorizeRound(round: V4Round, expected_net: string): Promise<V4Confirmed<V4Round>>;
    cancelRound(round: V4Round): Promise<V4Confirmed<V4Round>>;
    settleRound(round: V4Round): Promise<V4Confirmed<V4Round>>;
    expireRound(id: string): Promise<V4Confirmed<V4Round>>;
    releaseStaleRound(id: string): Promise<V4Confirmed<V4Round>>;
    listInvoices(cursor?: number, limit?: number, account_id?: string): Promise<V4Page<V4Invoice>>;
    listRounds(cursor?: number, limit?: number): Promise<V4Page<V4Round>>;
    listActivity(account_id?: string, cursor?: number, limit?: number): Promise<V4Page<{
        kind: string;
        reference: string;
        amount: string | null;
        at_ms: number;
    }>>;
    withdrawal(id: string): Promise<V4Withdrawal | null>;
    privateEncryptionKey(): Promise<V4EncryptionKey | null>;
    privateRequest(id: string): Promise<{
        status: string;
        id: string;
        deadline_ms: number;
        verification_only: boolean;
    } | null>;
    expirePrivateRequest(id: string): Promise<V4Confirmed<{
        status: string;
        id: string;
    }>>;
    privateInvoice(id: string): Promise<{
        status: string;
        charge: {
            commitment: string;
            buyer: string;
        };
        round_id: string | null;
    } | null>;
    privatePurchase(id: string): Promise<V4PrivatePurchaseAuthorization | null>;
    cancelPendingPrivatePurchase(order: V4PrivatePurchaseAuthorization): Promise<V4Confirmed<V4PrivatePurchaseAuthorization>>;
    authorizePrivatePurchase(request: {
        purchase_id: string;
        terms_version: number;
        seller: string;
        order_commitment: string;
        deadline_ms?: number;
    }): Promise<V4Confirmed<V4PrivatePurchaseAuthorization>>;
    requestPrivateRound(request: V4PrivateRoundRequest, sponsorPayment?: bigint): Promise<V4Confirmed<{
        id: string;
        status: string;
    }>>;
    withdraw(id: string, amount: V4Units): Promise<V4Confirmed<V4Withdrawal>>;
    recoveryWithdrawal(account_id?: string): Promise<V4Withdrawal & {
        sequence: number;
    }>;
    recoveryWithdraw(nonce: number, expected_available: V4Units): Promise<V4Confirmed<V4Withdrawal>>;
    deposit(id: string, amount: V4Units): Promise<V4Confirmed<string>>;
}
