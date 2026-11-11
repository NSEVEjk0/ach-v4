/**
 * Server-side data access for the ACH clearing contract.
 * Views are public — we read them straight from the RPC.
 */
import { cache } from "react";
import {
  reconcileRisk,
  reconcileStatement,
} from "../../packages/client/src/reconciliation";
import type {
  AvailableBalance,
  ClearPreview,
  ClearingResultDTO,
  ObligationDTO,
  ParticipantProfile,
  RiskRow as ClientRiskRow,
  SecurityConfig,
  SettlementDTO,
  StatementDTO,
  StatsDTO,
  TransferDTO,
} from "../../packages/client/src/index";

export type Participant = ParticipantProfile;
export type Obligation = ObligationDTO;
export type Transfer = TransferDTO;
export type NetResult = ClearingResultDTO;
export type Settlement = SettlementDTO;
export type Stats = StatsDTO;
export type RiskRow = ClientRiskRow;
export type Statement = StatementDTO;
export type { AvailableBalance, ClearPreview, SecurityConfig };

export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_ACH_CONTRACT ??
  process.env.ACH_CONTRACT ??
  "ach-clearing-v2.testnet";
export const RPC_URL = process.env.ACH_RPC ?? "https://test.rpc.fastnear.com";
export const AGENT_URL = process.env.ACH_AGENT_URL ?? "http://127.0.0.1:4170";

async function rpc(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    next: { revalidate: 5, tags: ["ach-contract"] },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok)
    throw new Error(`Contract data is temporarily unavailable (${res.status})`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export async function view<T>(
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  // Browser reads use the same server configuration as the pages and exports.
  if (typeof window !== "undefined") {
    const params = new URLSearchParams({ method, args: JSON.stringify(args) });
    const response = await fetch(`/api/contract?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "Could not load contract data");
    return data as T;
  }
  const raw = await rpc({
    method: "query",
    params: {
      request_type: "call_function",
      account_id: CONTRACT_ID,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "final",
    },
  });
  if (raw.error) throw new Error(raw.error);
  const bytes = Array.isArray(raw.result)
    ? Buffer.from(raw.result)
    : Buffer.from(raw.result, "base64");
  return JSON.parse(bytes.toString("utf8")) as T;
}

export const getStats = () => view<Stats>("get_stats");
export const getParticipants = () => view<Participant[]>("get_participants");

export const getSecurityConfig = cache(async (): Promise<SecurityConfig> => {
  if (typeof window !== "undefined")
    return view<SecurityConfig>("get_security_config");
  try {
    const config = await view<SecurityConfig>("get_security_config");
    if (
      !config ||
      !Number.isSafeInteger(config.version) ||
      config.version < 2 ||
      typeof config.ready !== "boolean" ||
      [
        config.bilateralApproval,
        config.strictDueTimes,
        config.reservedCollateral,
        config.bilateralDisputes,
      ].some((flag) => typeof flag !== "boolean")
    )
      throw new Error("Invalid contract security configuration");
    return config;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/MethodNotFound|does not exist|method.*not found/i.test(error.message)
    )
      throw error;
    return {
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
});

export async function getAvailableBalance(
  accountId: string,
): Promise<AvailableBalance> {
  if ((await getSecurityConfig()).version >= 3)
    return view<AvailableBalance>("get_available_balance", {
      account_id: accountId,
    });
  const balance = await getBalance(accountId);
  return {
    accountId,
    balance,
    reservedCollateral: "0",
    reservedPayable: "0",
    availableBalance: balance,
    withdrawalsEnabled: true,
  };
}

export async function getClearPreview(
  maxObligations = 10,
): Promise<ClearPreview | null> {
  if ((await getSecurityConfig()).version < 3) return null;
  return view<ClearPreview>("get_clear_preview", {
    max_obligations: maxObligations,
  });
}

export const getObligations = (
  filter: {
    status?: string;
    account_id?: string;
    limit?: number;
    start?: number;
  } = {},
) => view<Obligation[]>("get_obligations", filter);
export async function getLedger(): Promise<Obligation[]> {
  // The deployed contract returns archives oldest first. Load active records
  // separately so historical records cannot hide the current obligation web.
  const security = await getSecurityConfig();
  const groups = await Promise.all([
    getObligations({ limit: 200 }),
    getObligations({ status: "open", limit: 500 }),
    getObligations({ status: "disputed", limit: 500 }),
    ...(security.version >= 3
      ? [getObligations({ status: "pending", limit: 500 })]
      : []),
  ]);
  const records = new Map(groups.flat().map((record) => [record.id, record]));
  return [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
}
export const getSettlements = (limit = 50) =>
  view<Settlement[]>("get_settlements", { limit });
export const getNet = () =>
  view<NetResult>("compute_net_positions", { include_not_due: false });
export const getBalance = (accountId: string) =>
  view<string>("get_balance", { account_id: accountId });

export const getCreditLimits = () =>
  view<{ accountId: string; creditLimit: string }[]>("get_credit_limits");
export const getCollateralRatio = () => view<number>("get_collateral_ratio");

// Historical scans in the deployed risk and statement views exceed query gas.
// Reconcile the same public contract records using bounded, working views.
const getExposureSnapshot = cache(async () => {
  const security = await getSecurityConfig();
  const [participants, groups, limits, ratio, stats] = await Promise.all([
    getParticipants(),
    Promise.all(
      (security.version >= 3 ? ["open", "pending", "disputed"] : ["open"]).map(
        (status) => getObligations({ status, limit: 500 }),
      ),
    ),
    getCreditLimits(),
    getCollateralRatio(),
    getStats(),
  ]);
  const obligations = [
    ...new Map(groups.flat().map((o) => [o.id, o])).values(),
  ];
  const expected =
    stats.openObligations +
    (security.version >= 3
      ? (stats.pendingObligations ?? 0) + (stats.disputedObligations ?? 0)
      : 0);
  if (obligations.length < expected)
    throw new Error("The complete active ledger could not be loaded");
  const available =
    security.version >= 3
      ? await Promise.all(
          participants.map((p) => getAvailableBalance(p.accountId)),
        )
      : undefined;
  const balances = available
    ? available.map((row) => row.balance)
    : await Promise.all(participants.map((p) => getBalance(p.accountId)));
  const rows = reconcileRisk(
    participants,
    obligations,
    limits,
    ratio,
    balances,
    available,
  );
  return { participants, obligations, rows };
});

export async function getRisk(): Promise<RiskRow[]> {
  if (typeof window !== "undefined") return view<RiskRow[]>("get_risk");
  return (await getExposureSnapshot()).rows;
}

export async function getStatement(accountId: string): Promise<Statement> {
  if (typeof window !== "undefined")
    return view<Statement>("get_statement", { account_id: accountId });
  const [snapshot, rounds] = await Promise.all([
    getExposureSnapshot(),
    getSettlements(200),
  ]);
  return reconcileStatement(
    accountId,
    snapshot.participants,
    snapshot.obligations,
    snapshot.rows,
    rounds,
  );
}

export const yoctoToNear = (y: string | number | bigint) => Number(y) / 1e24;

export async function getAgentLog(): Promise<any[]> {
  try {
    const res = await fetch(`${AGENT_URL}/log`, {
      next: { revalidate: 3 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const log = await res.json();
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

export interface AgentStats {
  contract: string;
  startedAt: number;
  uptimeMs: number;
  roundsSettled: number;
  grossSettled: string;
  netSettled: string;
  compressionSaved: number;
  errors: number;
  pollMs?: number;
  minCompression?: number;
  lastRun: {
    at: number;
    openCount: number;
    grossVolume: string;
    netVolume: string;
    compression: number;
    transfers: Transfer[];
  } | null;
}

export async function getAgentStats(): Promise<AgentStats | null> {
  try {
    const res = await fetch(`${AGENT_URL}/stats`, {
      next: { revalidate: 3 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
