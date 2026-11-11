/**
 * ACH — typed client for the clearing contract on NEAR.
 *
 * Works with near-api-js v7. Views are public; calls require a signer
 * (a KeyPairString for server-side use, or a wallet-backed signer in the
 * browser).
 */

import { Account, JsonRpcProvider, actions } from "near-api-js";
import type { Action, Signer, KeyPairString } from "near-api-js";
import { reconcileRisk, reconcileStatement } from "./reconciliation.js";
export * from "./v4.js";
export {
  YOCTO_PER_NEAR,
  nearToYocto,
  formatNear,
  requiredCollateral,
} from "./amounts.js";

export const DEFAULT_RPC_URL = "https://test.rpc.fastnear.com";
export const DEFAULT_CONTRACT_ID = "ach-clearing-v2.testnet";

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
  positions: { accountId: string; net: string }[];
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

export class ClearingClient {
  readonly contractId: string;
  readonly provider: JsonRpcProvider;
  private account: Account | null = null;
  private securitySnapshot: { until: number; value: SecurityConfig } | null =
    null;

  constructor(opts: ClearingClientOptions = {}) {
    this.contractId = opts.contractId ?? DEFAULT_CONTRACT_ID;
    this.provider = new JsonRpcProvider({
      url: opts.rpcUrl ?? DEFAULT_RPC_URL,
    });
    if (opts.signer) {
      if (!opts.signerAccountId) {
        throw new Error(
          "signerAccountId is required when using a KeyPairString signer",
        );
      }
      this.account = new Account(
        opts.signerAccountId,
        this.provider,
        opts.signer,
      );
    }
  }

  /** Attach a signer later (e.g. after wallet login). */
  withSigner(
    signer: KeyPairString | Signer,
    accountId: string,
  ): ClearingClient {
    this.account = new Account(accountId, this.provider, signer);
    return this;
  }

  private async view<T>(
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const raw = (await this.provider.query({
      request_type: "call_function",
      account_id: this.contractId,
      method_name: method,
      args_base64: btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(args)), (byte) =>
          String.fromCharCode(byte),
        ).join(""),
      ),
      finality: "final",
    })) as any;
    // The RPC returns the contract's JSON return value as base64 bytes.
    if (raw.error) throw new Error(raw.error);
    const bytes =
      typeof raw.result === "string"
        ? Uint8Array.from(atob(raw.result), (character) =>
            character.charCodeAt(0),
          )
        : Uint8Array.from(raw.result);
    const decoded = new TextDecoder().decode(bytes);
    return JSON.parse(decoded) as T;
  }

  private static GAS: Record<string, bigint> = {
    // The protected batch also verifies and releases per-bill reservations.
    clear: BigInt("200000000000000"),
    accept_obligation: BigInt("60000000000000"),
    fund_obligation: BigInt("60000000000000"),
    withdraw: BigInt("60000000000000"),
  };

  private async call(
    method: string,
    args: Record<string, unknown>,
    deposit = "0",
  ): Promise<unknown> {
    if (!this.account)
      throw new Error("No signer attached — call withSigner() first");
    const gas = ClearingClient.GAS[method] ?? BigInt("30000000000000"); // 30 TGas default
    const res = (await this.account.signAndSendTransaction({
      receiverId: this.contractId,
      waitUntil: "FINAL",
      actions: [actions.functionCall(method, args, gas, BigInt(deposit))],
    })) as any;
    const success = res?.status?.SuccessValue;
    if (success === undefined) {
      throw new Error(`Transaction failed: ${JSON.stringify(res?.status)}`);
    }
    if (success === "") return undefined;
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(success), (character) => character.charCodeAt(0)),
      ),
    );
  }

  /* ---------------- views ---------------- */

  getParticipants(): Promise<ParticipantProfile[]> {
    return this.view("get_participants");
  }

  getParticipant(accountId: string): Promise<ParticipantProfile | null> {
    return this.view("get_participant", { account_id: accountId });
  }

  getBalance(accountId: string): Promise<string> {
    return this.view("get_balance", { account_id: accountId });
  }

  async getSecurityConfig(): Promise<SecurityConfig> {
    if (this.securitySnapshot && this.securitySnapshot.until > Date.now())
      return this.securitySnapshot.value;
    let value: SecurityConfig;
    try {
      value = await this.view<SecurityConfig>("get_security_config");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/MethodNotFound|does not exist|method.*not found/i.test(error.message)
      )
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
    if (
      !value ||
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
      ].some((amount) => typeof amount !== "string" || !/^\d+$/.test(amount))
    )
      throw new Error("Invalid contract security configuration");
    this.securitySnapshot = { until: Date.now() + 5_000, value };
    return value;
  }

  async getAvailableBalance(accountId: string): Promise<AvailableBalance> {
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

  async getClearingObligations(): Promise<ObligationDTO[]> {
    return (await this.getSecurityConfig()).version >= 3
      ? this.view("get_clearing_obligations")
      : this.getObligations({ status: "open", limit: 500 });
  }

  getObligation(obligationId: string): Promise<ObligationDTO | null> {
    return this.view("get_obligation", { obligation_id: obligationId });
  }

  async previewClear(
    maxObligations = 10,
    obligationIds?: string[],
  ): Promise<ClearPreview | null> {
    if ((await this.getSecurityConfig()).version < 3) return null;
    return this.view("get_clear_preview", {
      max_obligations: maxObligations,
      obligation_ids: obligationIds,
    });
  }

  getObligations(
    filter: {
      status?: string;
      account_id?: string;
      limit?: number;
      start?: number;
    } = {},
  ): Promise<ObligationDTO[]> {
    return this.view("get_obligations", filter);
  }

  getSettlements(limit = 50): Promise<SettlementDTO[]> {
    return this.view("get_settlements", { limit });
  }

  getStats(): Promise<StatsDTO> {
    return this.view("get_stats");
  }

  computeNetPositions(includeNotDue = false): Promise<ClearingResultDTO> {
    return this.view("compute_net_positions", {
      include_not_due: includeNotDue,
    });
  }

  private async exposureSnapshot() {
    const security = await this.getSecurityConfig();
    const [participants, groups, limits, ratio, stats] = await Promise.all([
      this.getParticipants(),
      Promise.all(
        (security.version >= 3
          ? ["open", "pending", "disputed"]
          : ["open"]
        ).map((status) => this.getObligations({ status, limit: 500 })),
      ),
      this.getCreditLimits(),
      this.getCollateralRatio(),
      this.getStats(),
    ]);
    const obligations = [
      ...new Map(groups.flat().map((o) => [o.id, o])).values(),
    ];
    const count =
      stats.openObligations +
      (security.version >= 3
        ? (stats.pendingObligations ?? 0) + (stats.disputedObligations ?? 0)
        : 0);
    if (obligations.length < count)
      throw new Error("The complete active ledger could not be loaded");
    const available =
      security.version >= 3
        ? await Promise.all(
            participants.map((p) => this.getAvailableBalance(p.accountId)),
          )
        : undefined;
    const balances = available
      ? available.map((row) => row.balance)
      : await Promise.all(
          participants.map((p) => this.getBalance(p.accountId)),
        );
    const rows = reconcileRisk(
      participants,
      obligations,
      limits,
      ratio,
      balances,
      available,
    );
    return { participants, obligations, rows };
  }

  async getRisk(): Promise<RiskRow[]> {
    try {
      return await this.view("get_risk");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("GasLimitExceeded")
      )
        throw error;
      return (await this.exposureSnapshot()).rows;
    }
  }

  /** Large-history fallback includes transfers across the latest 200 rounds. */
  async getStatement(accountId: string): Promise<StatementDTO> {
    try {
      return await this.view("get_statement", { account_id: accountId });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("GasLimitExceeded")
      )
        throw error;
      const [snapshot, rounds] = await Promise.all([
        this.exposureSnapshot(),
        this.getSettlements(200),
      ]);
      return reconcileStatement(
        accountId,
        snapshot.participants,
        snapshot.obligations,
        snapshot.rows,
        rounds,
      );
    }
  }

  getCreditLimits(): Promise<{ accountId: string; creditLimit: string }[]> {
    return this.view("get_credit_limits");
  }

  getCollateralRatio(): Promise<number> {
    return this.view("get_collateral_ratio");
  }

  /* ---------------- calls ---------------- */

  async join(profile: {
    name: string;
    kind: string;
    bio: string;
    icon: string;
  }): Promise<void> {
    await this.call(
      "join",
      profile,
      (await this.getSecurityConfig()).registrationDeposit,
    );
  }

  async deposit(amountYocto: string): Promise<void> {
    await this.call("deposit", {}, amountYocto);
  }

  async withdraw(amountYocto: string): Promise<void> {
    await this.call(
      "withdraw",
      { amount: amountYocto },
      (await this.getSecurityConfig()).withdrawalDeposit,
    );
  }

  async recordObligation(args: {
    debtor: string;
    creditor: string;
    amount: string;
    memo: string;
    dueAt?: number | null;
  }): Promise<string> {
    const res = (await this.call(
      "record_obligation",
      {
        debtor: args.debtor,
        creditor: args.creditor,
        amount: args.amount,
        memo: args.memo,
        due_at: args.dueAt ?? null,
      },
      (await this.getSecurityConfig()).proposalDeposit,
    )) as any;
    return res?.id ?? "";
  }

  async acceptObligation(obligationId: string): Promise<ObligationDTO> {
    return (await this.call("accept_obligation", {
      obligation_id: obligationId,
    })) as ObligationDTO;
  }

  async fundObligation(obligationId: string): Promise<ObligationDTO> {
    return (await this.call("fund_obligation", {
      obligation_id: obligationId,
    })) as ObligationDTO;
  }

  async rejectObligation(obligationId: string): Promise<ObligationDTO> {
    return (await this.call("reject_obligation", {
      obligation_id: obligationId,
    })) as ObligationDTO;
  }

  async dispute(obligationId: string): Promise<void> {
    await this.call("dispute", { obligation_id: obligationId });
  }

  async resolveDispute(
    obligationId: string,
    outcome: "keep" | "void",
  ): Promise<void> {
    await this.call("resolve_dispute", {
      obligation_id: obligationId,
      outcome,
    });
  }

  async clear(
    includeNotDue = false,
    maxObligations?: number,
    obligationIds?: string[],
  ): Promise<ClearResult> {
    return (await this.call("clear", {
      include_not_due: includeNotDue,
      max_obligations: maxObligations,
      obligation_ids: obligationIds,
    })) as ClearResult;
  }

  async setCreditLimit(accountId: string, limitYocto: string): Promise<void> {
    await this.call("set_credit_limit", {
      account_id: accountId,
      limit: limitYocto,
    });
  }

  async setCollateralRatio(ratio: number): Promise<void> {
    await this.call("set_collateral_ratio", { ratio });
  }
}
