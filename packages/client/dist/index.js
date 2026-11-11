/**
 * ACH — typed client for the clearing contract on NEAR.
 *
 * Works with near-api-js v7. Views are public; calls require a signer
 * (a KeyPairString for server-side use, or a wallet-backed signer in the
 * browser).
 */
import { Account, JsonRpcProvider, actions } from "near-api-js";
import { reconcileRisk, reconcileStatement } from "./reconciliation.js";
export * from "./v4.js";
export { YOCTO_PER_NEAR, nearToYocto, formatNear, requiredCollateral, } from "./amounts.js";
export const DEFAULT_RPC_URL = "https://test.rpc.fastnear.com";
export const DEFAULT_CONTRACT_ID = "ach-clearing-v2.testnet";
export class ClearingClient {
    contractId;
    provider;
    account = null;
    securitySnapshot = null;
    constructor(opts = {}) {
        this.contractId = opts.contractId ?? DEFAULT_CONTRACT_ID;
        this.provider = new JsonRpcProvider({
            url: opts.rpcUrl ?? DEFAULT_RPC_URL,
        });
        if (opts.signer) {
            if (!opts.signerAccountId) {
                throw new Error("signerAccountId is required when using a KeyPairString signer");
            }
            this.account = new Account(opts.signerAccountId, this.provider, opts.signer);
        }
    }
    /** Attach a signer later (e.g. after wallet login). */
    withSigner(signer, accountId) {
        this.account = new Account(accountId, this.provider, signer);
        return this;
    }
    async view(method, args = {}) {
        const raw = (await this.provider.query({
            request_type: "call_function",
            account_id: this.contractId,
            method_name: method,
            args_base64: btoa(Array.from(new TextEncoder().encode(JSON.stringify(args)), (byte) => String.fromCharCode(byte)).join("")),
            finality: "final",
        }));
        // The RPC returns the contract's JSON return value as base64 bytes.
        if (raw.error)
            throw new Error(raw.error);
        const bytes = typeof raw.result === "string"
            ? Uint8Array.from(atob(raw.result), (character) => character.charCodeAt(0))
            : Uint8Array.from(raw.result);
        const decoded = new TextDecoder().decode(bytes);
        return JSON.parse(decoded);
    }
    static GAS = {
        // The protected batch also verifies and releases per-bill reservations.
        clear: BigInt("200000000000000"),
        accept_obligation: BigInt("60000000000000"),
        fund_obligation: BigInt("60000000000000"),
        withdraw: BigInt("60000000000000"),
    };
    async call(method, args, deposit = "0") {
        if (!this.account)
            throw new Error("No signer attached — call withSigner() first");
        const gas = ClearingClient.GAS[method] ?? BigInt("30000000000000"); // 30 TGas default
        const res = (await this.account.signAndSendTransaction({
            receiverId: this.contractId,
            waitUntil: "FINAL",
            actions: [actions.functionCall(method, args, gas, BigInt(deposit))],
        }));
        const success = res?.status?.SuccessValue;
        if (success === undefined) {
            throw new Error(`Transaction failed: ${JSON.stringify(res?.status)}`);
        }
        if (success === "")
            return undefined;
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(success), (character) => character.charCodeAt(0))));
    }
    /* ---------------- views ---------------- */
    getParticipants() {
        return this.view("get_participants");
    }
    getParticipant(accountId) {
        return this.view("get_participant", { account_id: accountId });
    }
    getBalance(accountId) {
        return this.view("get_balance", { account_id: accountId });
    }
    async getSecurityConfig() {
        if (this.securitySnapshot && this.securitySnapshot.until > Date.now())
            return this.securitySnapshot.value;
        let value;
        try {
            value = await this.view("get_security_config");
        }
        catch (error) {
            if (!(error instanceof Error) ||
                !/MethodNotFound|does not exist|method.*not found/i.test(error.message))
                throw error;
            value = {
                version: 2,
                ready: true,
                bilateralApproval: false,
                strictDueTimes: false,
                reservedCollateral: false,
                bilateralDisputes: false,
                registrationDeposit: "0",
                proposalDeposit: "0",
                withdrawalDeposit: "0",
            };
        }
        if (!value ||
            !Number.isSafeInteger(value.version) ||
            value.version < 2 ||
            typeof value.ready !== "boolean" ||
            [
                value.bilateralApproval,
                value.strictDueTimes,
                value.reservedCollateral,
                value.bilateralDisputes,
            ].some((flag) => typeof flag !== "boolean") ||
            [
                value.registrationDeposit,
                value.proposalDeposit,
                value.withdrawalDeposit,
            ].some((amount) => typeof amount !== "string" || !/^\d+$/.test(amount)))
            throw new Error("Invalid contract security configuration");
        this.securitySnapshot = { until: Date.now() + 5_000, value };
        return value;
    }
    async getAvailableBalance(accountId) {
        if ((await this.getSecurityConfig()).version >= 3)
            return this.view("get_available_balance", { account_id: accountId });
        const balance = await this.getBalance(accountId);
        return {
            accountId,
            balance,
            reservedCollateral: "0",
            reservedPayable: "0",
            availableBalance: balance,
            withdrawalsEnabled: true,
        };
    }
    async getClearingObligations() {
        return (await this.getSecurityConfig()).version >= 3
            ? this.view("get_clearing_obligations")
            : this.getObligations({ status: "open", limit: 500 });
    }
    getObligation(obligationId) {
        return this.view("get_obligation", { obligation_id: obligationId });
    }
    async previewClear(maxObligations = 10, obligationIds) {
        if ((await this.getSecurityConfig()).version < 3)
            return null;
        return this.view("get_clear_preview", {
            max_obligations: maxObligations,
            obligation_ids: obligationIds,
        });
    }
    getObligations(filter = {}) {
        return this.view("get_obligations", filter);
    }
    getSettlements(limit = 50) {
        return this.view("get_settlements", { limit });
    }
    getStats() {
        return this.view("get_stats");
    }
    computeNetPositions(includeNotDue = false) {
        return this.view("compute_net_positions", {
            include_not_due: includeNotDue,
        });
    }
    async exposureSnapshot() {
        const security = await this.getSecurityConfig();
        const [participants, groups, limits, ratio, stats] = await Promise.all([
            this.getParticipants(),
            Promise.all((security.version >= 3
                ? ["open", "pending", "disputed"]
                : ["open"]).map((status) => this.getObligations({ status, limit: 500 }))),
            this.getCreditLimits(),
            this.getCollateralRatio(),
            this.getStats(),
        ]);
        const obligations = [
            ...new Map(groups.flat().map((o) => [o.id, o])).values(),
        ];
        const count = stats.openObligations +
            (security.version >= 3
                ? (stats.pendingObligations ?? 0) + (stats.disputedObligations ?? 0)
                : 0);
        if (obligations.length < count)
            throw new Error("The complete active ledger could not be loaded");
        const available = security.version >= 3
            ? await Promise.all(participants.map((p) => this.getAvailableBalance(p.accountId)))
            : undefined;
        const balances = available
            ? available.map((row) => row.balance)
            : await Promise.all(participants.map((p) => this.getBalance(p.accountId)));
        const rows = reconcileRisk(participants, obligations, limits, ratio, balances, available);
        return { participants, obligations, rows };
    }
    async getRisk() {
        try {
            return await this.view("get_risk");
        }
        catch (error) {
            if (!(error instanceof Error) ||
                !error.message.includes("GasLimitExceeded"))
                throw error;
            return (await this.exposureSnapshot()).rows;
        }
    }
    /** Large-history fallback includes transfers across the latest 200 rounds. */
    async getStatement(accountId) {
        try {
            return await this.view("get_statement", { account_id: accountId });
        }
        catch (error) {
            if (!(error instanceof Error) ||
                !error.message.includes("GasLimitExceeded"))
                throw error;
            const [snapshot, rounds] = await Promise.all([
                this.exposureSnapshot(),
                this.getSettlements(200),
            ]);
            return reconcileStatement(accountId, snapshot.participants, snapshot.obligations, snapshot.rows, rounds);
        }
    }
    getCreditLimits() {
        return this.view("get_credit_limits");
    }
    getCollateralRatio() {
        return this.view("get_collateral_ratio");
    }
    /* ---------------- calls ---------------- */
    async join(profile) {
        await this.call("join", profile, (await this.getSecurityConfig()).registrationDeposit);
    }
    async deposit(amountYocto) {
        await this.call("deposit", {}, amountYocto);
    }
    async withdraw(amountYocto) {
        await this.call("withdraw", { amount: amountYocto }, (await this.getSecurityConfig()).withdrawalDeposit);
    }
    async recordObligation(args) {
        const res = (await this.call("record_obligation", {
            debtor: args.debtor,
            creditor: args.creditor,
            amount: args.amount,
            memo: args.memo,
            due_at: args.dueAt ?? null,
        }, (await this.getSecurityConfig()).proposalDeposit));
        return res?.id ?? "";
    }
    async acceptObligation(obligationId) {
        return (await this.call("accept_obligation", {
            obligation_id: obligationId,
        }));
    }
    async fundObligation(obligationId) {
        return (await this.call("fund_obligation", {
            obligation_id: obligationId,
        }));
    }
    async rejectObligation(obligationId) {
        return (await this.call("reject_obligation", {
            obligation_id: obligationId,
        }));
    }
    async dispute(obligationId) {
        await this.call("dispute", { obligation_id: obligationId });
    }
    async resolveDispute(obligationId, outcome) {
        await this.call("resolve_dispute", {
            obligation_id: obligationId,
            outcome,
        });
    }
    async clear(includeNotDue = false, maxObligations, obligationIds) {
        return (await this.call("clear", {
            include_not_due: includeNotDue,
            max_obligations: maxObligations,
            obligation_ids: obligationIds,
        }));
    }
    async setCreditLimit(accountId, limitYocto) {
        await this.call("set_credit_limit", {
            account_id: accountId,
            limit: limitYocto,
        });
    }
    async setCollateralRatio(ratio) {
        await this.call("set_collateral_ratio", { ratio });
    }
}
