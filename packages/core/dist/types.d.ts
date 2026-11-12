/**
 * ACH — Autonomous Clearing House
 * Shared domain types for the multilateral netting engine.
 *
 * Amounts are always bigint in the smallest unit of the settlement
 * currency (e.g. yoctoNEAR). The same types are used by the on-chain
 * contract, the agent service, and the web app.
 */
export type ObligationStatus = "open" | "disputed" | "settled" | "voided";
export interface Obligation {
    /** Unique id, e.g. "obl-<uuid>" */
    id: string;
    /** Account that owes */
    debtor: string;
    /** Account that is owed */
    creditor: string;
    /** Amount in smallest units */
    amount: bigint;
    /** Human-readable description of the underlying service/work */
    memo: string;
    /** Unix ms when recorded */
    createdAt: number;
    /** Unix ms after which this obligation may be cleared; null = immediately */
    dueAt: number | null;
    status: ObligationStatus;
    /** Account id that disputed, if status === "disputed" */
    disputedBy?: string;
}
export interface NetPosition {
    accountId: string;
    /** Positive = net creditor, negative = net debtor */
    net: bigint;
}
export interface Transfer {
    from: string;
    to: string;
    amount: bigint;
}
export interface ClearingResult {
    /** Net position of every participant with nonzero exposure */
    positions: NetPosition[];
    /** Greedy transfer pairing; no claim of a globally minimum leg count. */
    transfers: Transfer[];
    /** Sum of all gross obligations considered */
    grossVolume: bigint;
    /** Sum of all net transfers */
    netVolume: bigint;
    /** Legacy settlement ratio, netVolume/grossVolume. Prefer the explicit fields. */
    compression: number;
    /** Net settlement volume divided by gross invoice volume. */
    settlementRatio: number;
    /** Fraction of billed volume offset (1 - settlementRatio). */
    volumeReduction: number;
    /** Number of obligations that went into this round */
    obligationCount: number;
    /** Ids of the obligations settled */
    obligationIds: string[];
}
export interface ParticipantProfile {
    accountId: string;
    name: string;
    /** e.g. "trader", "analyst", "designer", "data", "infra" */
    kind: string;
    /** Short bio shown in the app */
    bio: string;
    /** Optional avatar emoji / icon key */
    icon: string;
    createdAt: number;
}
/** Input to the netting engine: obligations that are eligible for clearing */
export type NettingInput = Pick<Obligation, "id" | "debtor" | "creditor" | "amount">[];
