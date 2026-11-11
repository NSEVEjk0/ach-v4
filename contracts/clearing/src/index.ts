import {
  NearBindgen,
  call,
  view,
  initialize,
  near,
  LookupMap,
  UnorderedMap,
  assert,
  validateAccountId,
} from "near-sdk-js";

import { clearObligations } from "./netting";
import type { ClearingResult, Transfer } from "./netting";
import { requiredCollateral } from "../../../packages/client/src/amounts";

/**
 * Current time in milliseconds since epoch.
 *
 * NB: `Date.now()` returns 0 inside the NEAR JS VM (not implemented), so we
 * read the block timestamp instead (nanoseconds) and convert to ms. This is
 * what backs settlement timestamps, obligation createdAt, and due-date checks.
 */
function nowMs(): number {
  return Number(near.blockTimestamp() / 1000000n);
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type ObligationStatus = "pending" | "open" | "disputed" | "settled" | "voided";

interface Approval {
  proposer: string;
  debtorApproved: boolean;
  creditorApproved: boolean;
  funded: boolean;
  legacy?: boolean;
  legacyFinalized?: boolean;
  debtorResolution?: "keep" | "void";
  creditorResolution?: "keep" | "void";
}

interface SecurityState {
  version: number;
  ready: boolean;
  cursor: number;
  legacyTotal: number;
  unresolvedLegacy: number;
}

interface Obligation {
  id: string;
  debtor: string;
  creditor: string;
  amount: bigint;
  memo: string;
  createdAt: number;
  dueAt: number | null;
  status: ObligationStatus;
  disputedBy?: string;
}

interface ParticipantProfile {
  accountId: string;
  name: string;
  kind: string;
  bio: string;
  icon: string;
  createdAt: number;
  /** Max net debit this participant will accept per round. 0 = unlimited. */
  creditLimit: bigint;
}

interface SettlementRecord {
  id: string;
  timestamp: number;
  grossVolume: bigint;
  netVolume: bigint;
  compression: number;
  obligationCount: number;
  obligationIds: string[];
  transfers: Transfer[];
}

/* JSON-safe DTOs (bigint → string) for view methods */

interface ObligationDTO {
  id: string;
  debtor: string;
  creditor: string;
  amount: string;
  memo: string;
  createdAt: number;
  dueAt: number | null;
  status: ObligationStatus;
  disputedBy?: string;
  proposer?: string;
  debtorApproved: boolean;
  creditorApproved: boolean;
  funded: boolean;
  legacyReview: boolean;
  debtorResolution?: "keep" | "void";
  creditorResolution?: "keep" | "void";
}

interface TransferDTO {
  from: string;
  to: string;
  amount: string;
}

interface ClearingResultDTO {
  positions: { accountId: string; net: string }[];
  transfers: TransferDTO[];
  grossVolume: string;
  netVolume: string;
  compression: number;
  obligationCount: number;
  obligationIds: string[];
}

interface SettlementDTO {
  id: string;
  timestamp: number;
  grossVolume: string;
  netVolume: string;
  compression: number;
  obligationCount: number;
  obligationIds: string[];
  transfers: TransferDTO[];
}

const STORAGE_BYTES_PER_PARTICIPANT = 4096n;
const STORAGE_BYTES_PER_OBLIGATION = 4096n;
const MAX_MEMO_LEN = 200;
const MAX_AMOUNT = (1n << 128n) - 1n;

@NearBindgen({})
export class ClearingHouse {
  ownerId: string;
  participants: UnorderedMap<ParticipantProfile>;
  balances: LookupMap<bigint>;
  obligations: UnorderedMap<Obligation>;
  settlements: UnorderedMap<SettlementRecord>;
  nextObligationId: number;
  nextSettlementId: number;
  totalObligations: number;
  totalSettledVolume: bigint;
  /** Collateral ratio: a net debtor must hold balance >= ratio × net debit. */
  collateralRatio: number;

  constructor() {
    this.ownerId = "";
    this.participants = new UnorderedMap("p");
    this.balances = new LookupMap("b");
    this.obligations = new UnorderedMap("o");
    this.settlements = new UnorderedMap("s");
    this.nextObligationId = 1;
    this.nextSettlementId = 1;
    this.totalObligations = 0;
    this.totalSettledVolume = 0n;
    this.collateralRatio = 1;
  }

  private json<T>(key: string): T | null {
    const raw = near.storageRead(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  private store(key: string, value: unknown) {
    near.storageWrite(key, JSON.stringify(value));
  }

  private security(): SecurityState | null {
    return this.json<SecurityState>("security_v3");
  }

  private assertOwner() {
    assert(
      near.predecessorAccountId() === this.ownerId,
      "Only the owner may perform maintenance",
    );
  }

  private assertReady() {
    assert(
      this.security()?.ready === true,
      "Security upgrade requires legacy review before financial operations",
    );
  }

  private approval(id: string): Approval | null {
    return this.json<Approval>(`approval:${id}`);
  }

  private approved(approval: Approval | null): boolean {
    return (
      approval?.debtorApproved === true && approval?.creditorApproved === true
    );
  }

  private activeIds(): string[] {
    return this.json<string[]>("security_active_ids") ?? [];
  }

  private addActive(id: string) {
    const ids = this.activeIds();
    if (!ids.includes(id)) {
      ids.push(id);
      this.store("security_active_ids", ids);
    }
  }

  private removeActive(id: string) {
    this.store(
      "security_active_ids",
      this.activeIds().filter((current) => current !== id),
    );
  }

  private reservedGross(accountId: string): bigint {
    const value = near.storageRead(`reserved_payable:${accountId}`);
    return value === null ? 0n : BigInt(value);
  }

  private changeReservation(accountId: string, amount: bigint) {
    const next = this.reservedGross(accountId) + amount;
    assert(next >= 0n, "Invalid collateral reservation");
    near.storageWrite(`reserved_payable:${accountId}`, next.toString());
  }

  private effectiveRatio(): number {
    return Math.max(1, this.collateralRatio ?? 1);
  }

  private collateral(accountId: string): bigint {
    return requiredCollateral(
      this.reservedGross(accountId),
      this.effectiveRatio(),
    );
  }

  private amount(value: string): bigint {
    assert(
      typeof value === "string" && /^[0-9]{1,39}$/.test(value),
      "Amount must be an unsigned decimal integer",
    );
    const result = BigInt(value);
    assert(
      result > 0n && result <= MAX_AMOUNT,
      "Amount must be positive and fit NEAR's 128-bit amount range",
    );
    return result;
  }

  private dto(obl: Obligation): ObligationDTO {
    const approval = this.approval(obl.id);
    const unfinished =
      !approval ||
      (approval.legacy === true && approval.legacyFinalized !== true);
    return {
      id: obl.id,
      debtor: obl.debtor,
      creditor: obl.creditor,
      amount: obl.amount.toString(),
      memo: obl.memo,
      createdAt: obl.createdAt,
      dueAt: obl.dueAt,
      status: obl.status === "open" && unfinished ? "pending" : obl.status,
      disputedBy: obl.disputedBy,
      proposer: approval?.proposer,
      debtorApproved: approval?.debtorApproved ?? false,
      creditorApproved: approval?.creditorApproved ?? false,
      funded: approval?.funded ?? false,
      legacyReview:
        (obl.status === "open" || obl.status === "disputed") && unfinished,
      debtorResolution: approval?.debtorResolution,
      creditorResolution: approval?.creditorResolution,
    };
  }

  private finalizeLegacy(approval: Approval) {
    if (approval.legacy && !approval.legacyFinalized) {
      const state = this.security()!;
      assert(state.unresolvedLegacy > 0, "Invalid legacy review count");
      state.unresolvedLegacy--;
      this.store("security_v3", state);
      approval.legacyFinalized = true;
    }
  }

  private tryFund(obl: Obligation, approval: Approval): boolean {
    assert(this.approved(approval), "Both parties must approve the bill first");
    assert(
      obl.status !== "settled" && obl.status !== "voided",
      "Terminal obligations cannot be funded again",
    );
    if (approval.funded) return true;
    const required = requiredCollateral(
      this.reservedGross(obl.debtor) + obl.amount,
      this.effectiveRatio(),
    );
    if ((this.balances.get(obl.debtor) ?? 0n) < required) return false;
    this.changeReservation(obl.debtor, obl.amount);
    approval.funded = true;
    if (obl.status !== "disputed") {
      obl.status = "open";
      this.addOpenId(obl.id);
    }
    this.finalizeLegacy(approval);
    return true;
  }

  @view({})
  get_security_config() {
    const state = this.security();
    return {
      version: 3,
      ready: state?.ready ?? false,
      legacyReviewRequired: state?.unresolvedLegacy ?? null,
      migrationCursor: state?.cursor ?? 0,
      migrationTotal: state?.legacyTotal ?? this.obligations.length,
      bilateralApproval: true,
      strictDueTimes: true,
      reservedCollateral: true,
      bilateralDisputes: true,
      registrationDeposit: (
        STORAGE_BYTES_PER_PARTICIPANT * near.storageByteCost()
      ).toString(),
      proposalDeposit: (
        STORAGE_BYTES_PER_OBLIGATION * near.storageByteCost()
      ).toString(),
      withdrawalDeposit: "1",
    };
  }

  @call({})
  start_security_upgrade() {
    this.assertOwner();
    assert(this.security() === null, "Security upgrade already started");
    this.collateralRatio = this.effectiveRatio();
    this.store("security_v3", {
      version: 3,
      ready: false,
      cursor: 0,
      legacyTotal: this.obligations.length,
      unresolvedLegacy: 0,
    } as SecurityState);
    this.store("security_active_ids", []);
    return this.get_security_config();
  }

  @call({})
  migrate_security_batch({ limit = 25 }: { limit?: number }) {
    this.assertOwner();
    const state = this.security();
    assert(state !== null && !state.ready, "No security review is in progress");
    assert(
      Number.isSafeInteger(limit) && limit > 0 && limit <= 50,
      "Migration limit must be 1-50",
    );
    const keys = this.obligations.keys({
      start: state.cursor,
      limit: Math.min(limit, state.legacyTotal - state.cursor),
    });
    for (const id of keys) {
      const obl = this.obligations.get(id)!;
      if (obl.status === "open" || obl.status === "disputed") {
        this.store(`approval:${id}`, {
          proposer: "",
          debtorApproved: false,
          creditorApproved: false,
          funded: false,
          legacy: true,
        } as Approval);
        this.addActive(id);
        state.unresolvedLegacy++;
      }
    }
    state.cursor += keys.length;
    this.store("security_v3", state);
    return this.get_security_config();
  }

  @call({})
  finish_security_upgrade() {
    this.assertOwner();
    const state = this.security();
    assert(state !== null && !state.ready, "No security review is in progress");
    assert(state.cursor === state.legacyTotal, "Legacy scan is incomplete");
    assert(
      state.unresolvedLegacy === 0,
      "Legacy obligations still require bilateral approval and collateral",
    );
    state.ready = true;
    this.store("security_v3", state);
    return this.get_security_config();
  }

  /* ---------------------------------------------------------------- */
  /* Open-obligation index (raw storage — avoids state-layout breaks)   */
  /* ---------------------------------------------------------------- */

  private static OPEN_IDS_KEY = "open_ids";

  private openIds(): string[] {
    const raw = near.storageRead(ClearingHouse.OPEN_IDS_KEY);
    if (raw === null) return this.migrateOpenIds();
    return JSON.parse(raw) as string[];
  }

  private persistOpenIds(ids: string[]) {
    near.storageWrite(ClearingHouse.OPEN_IDS_KEY, JSON.stringify(ids));
  }

  /** One-time backfill from existing obligations (safe to re-run). */
  private migrateOpenIds(): string[] {
    const ids: string[] = [];
    for (const [id, obl] of this.obligations.toArray()) {
      if (obl.status === "open") ids.push(id);
    }
    this.persistOpenIds(ids);
    return ids;
  }

  /**
   * Chunked backfill of the open-obligation index. Iterating all stored
   * obligations in one call exceeds the 300 TGas cap once history grows,
   * so we process `batch_size` per call and persist a cursor.
   */
  @call({})
  migrate_open_index({ batch_size }: { batch_size?: number }) {
    this.assertOwner();
    const requested = batch_size ?? 50;
    assert(
      Number.isSafeInteger(requested) && requested > 0 && requested <= 100,
      "Index batch must be 1-100",
    );
    const cursorKey = "open_ids_cursor";
    const rawCursor = near.storageRead(cursorKey);
    const start = rawCursor === null ? 0 : Number(rawCursor);
    const keys = this.obligations.keys({
      start,
      limit: Math.min(requested, Math.max(0, this.obligations.length - start)),
    });
    const end = start + keys.length;
    const rawIds = near.storageRead(ClearingHouse.OPEN_IDS_KEY);
    const ids: string[] =
      rawIds === null ? [] : (JSON.parse(rawIds) as string[]);
    let added = 0;
    for (const id of keys) {
      const obl = this.obligations.get(id)!;
      if (obl.status === "open" && !ids.includes(id)) {
        ids.push(id);
        added += 1;
      }
    }
    near.storageWrite(ClearingHouse.OPEN_IDS_KEY, JSON.stringify(ids));
    if (end >= this.obligations.length) {
      near.storageRemove(cursorKey);
      return { done: true, processed: end, added };
    }
    near.storageWrite(cursorKey, String(end));
    return { done: false, processed: end, added, next: end };
  }

  private addOpenId(id: string) {
    const ids = this.openIds();
    if (!ids.includes(id)) {
      ids.push(id);
      this.persistOpenIds(ids);
    }
  }

  private removeOpenId(id: string) {
    const ids = this.openIds();
    const idx = ids.indexOf(id);
    if (idx !== -1) {
      ids.splice(idx, 1);
      this.persistOpenIds(ids);
    }
  }

  @initialize({})
  init({ owner_id }: { owner_id: string }) {
    validateAccountId(owner_id);
    this.ownerId = owner_id;
    this.store("security_v3", {
      version: 3,
      ready: true,
      cursor: 0,
      legacyTotal: 0,
      unresolvedLegacy: 0,
    } as SecurityState);
    this.store("security_active_ids", []);
    this.persistOpenIds([]);
  }

  /* ---------------------------------------------------------------- */
  /* Registration                                                      */
  /* ---------------------------------------------------------------- */

  @call({ payableFunction: true })
  join({
    name,
    kind,
    bio,
    icon,
  }: {
    name: string;
    kind: string;
    bio: string;
    icon: string;
  }) {
    this.assertReady();
    const accountId = near.predecessorAccountId();
    assert(this.participants.get(accountId) === null, "Already registered");
    assert(name.length >= 2 && name.length <= 40, "Name must be 2-40 chars");
    assert(kind.length >= 2 && kind.length <= 24, "Kind must be 2-24 chars");
    assert(bio.length <= 200, "Bio too long");
    assert(icon.length <= 8, "Icon too long");

    assert(
      near.attachedDeposit() ===
        STORAGE_BYTES_PER_PARTICIPANT * near.storageByteCost(),
      "Attach the registration storage deposit",
    );
    // New accounts fund their own storage instead of spending clearing deposits.
    this.participants.set(accountId, {
      accountId,
      name,
      kind,
      bio,
      icon,
      createdAt: nowMs(),
      creditLimit: 0n,
    });
    return { accountId };
  }

  @view({})
  get_participants(): ParticipantProfile[] {
    return this.participants.toArray().map(([, p]) => p);
  }

  @view({})
  get_participant({
    account_id,
  }: {
    account_id: string;
  }): ParticipantProfile | null {
    return this.participants.get(account_id) ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Risk controls: credit limits & collateral ratio                  */
  /* ---------------------------------------------------------------- */

  @call({})
  set_credit_limit({
    account_id,
    limit,
  }: {
    account_id: string;
    limit: string;
  }) {
    this.assertReady();
    const caller = near.predecessorAccountId();
    assert(caller === this.ownerId, "Only the owner can set credit limits");
    const participant = this.participants.get(account_id);
    assert(participant !== null, "Participant not found");
    const limitBig = BigInt(limit);
    assert(limitBig >= 0n, "Limit must be >= 0");
    participant.creditLimit = limitBig;
    this.participants.set(account_id, participant);
    return { account_id, creditLimit: limitBig.toString() };
  }

  @call({})
  set_collateral_ratio({ ratio }: { ratio: number }) {
    this.assertReady();
    const caller = near.predecessorAccountId();
    assert(
      caller === this.ownerId,
      "Only the owner can set the collateral ratio",
    );
    assert(
      Number.isFinite(ratio) && ratio >= 1 && ratio <= 10,
      "Ratio must be 1-10",
    );
    requiredCollateral(1n, ratio);
    this.collateralRatio = ratio;
    return { collateralRatio: ratio };
  }

  @view({})
  get_collateral_ratio(): number {
    return this.effectiveRatio();
  }

  @view({})
  get_credit_limits(): { accountId: string; creditLimit: string }[] {
    return this.participants
      .toArray()
      .map(([, p]) => ({
        accountId: p.accountId,
        creditLimit: (p.creditLimit ?? 0n).toString(),
      }));
  }

  /* ---------------------------------------------------------------- */
  /* Statements & risk (reconciliation)                                */
  /* ---------------------------------------------------------------- */

  private participantExposure(accountId: string) {
    let grossPayable = 0n,
      grossReceivable = 0n;
    const openIncoming: ObligationDTO[] = [],
      openOutgoing: ObligationDTO[] = [];
    const pendingIncoming: ObligationDTO[] = [],
      pendingOutgoing: ObligationDTO[] = [];
    for (const id of this.activeIds()) {
      const obl = this.obligations.get(id);
      if (
        obl === null ||
        (obl.debtor !== accountId && obl.creditor !== accountId)
      )
        continue;
      const dto = this.dto(obl);
      if (dto.funded && dto.debtorApproved && dto.creditorApproved) {
        if (obl.debtor === accountId) {
          grossPayable += obl.amount;
          openOutgoing.push(dto);
        } else {
          grossReceivable += obl.amount;
          openIncoming.push(dto);
        }
      } else {
        if (obl.debtor === accountId) pendingOutgoing.push(dto);
        else pendingIncoming.push(dto);
      }
    }
    return {
      grossPayable,
      grossReceivable,
      openIncoming,
      openOutgoing,
      pendingIncoming,
      pendingOutgoing,
    };
  }

  @view({})
  get_statement({ account_id }: { account_id: string }) {
    assert(this.participants.get(account_id) !== null, "Participant not found");
    const balance = this.balances.get(account_id) ?? 0n;
    const participant = this.participants.get(account_id)!;
    const {
      grossPayable,
      grossReceivable,
      openIncoming,
      openOutgoing,
      pendingIncoming,
      pendingOutgoing,
    } = this.participantExposure(account_id);
    const netPosition = grossReceivable - grossPayable;

    // Settlement history involving this participant.
    const settlements: {
      id: string;
      timestamp: number;
      netVolume: string;
      compression: number;
      transfers: TransferDTO[];
    }[] = [];
    for (const s of this.get_settlements({ limit: 200 })) {
      const mine = s.transfers.filter(
        (t) => t.from === account_id || t.to === account_id,
      );
      if (mine.length > 0) {
        settlements.push({
          id: s.id,
          timestamp: s.timestamp,
          netVolume: s.netVolume.toString(),
          compression: s.compression,
          transfers: mine.map((t) => ({
            from: t.from,
            to: t.to,
            amount: t.amount.toString(),
          })),
        });
      }
    }

    return {
      accountId: account_id,
      name: participant.name,
      kind: participant.kind,
      balance: balance.toString(),
      creditLimit: (participant.creditLimit ?? 0n).toString(),
      grossPayable: grossPayable.toString(),
      grossReceivable: grossReceivable.toString(),
      netPosition: netPosition.toString(),
      openIncoming,
      openOutgoing,
      pendingIncoming,
      pendingOutgoing,
      securityVersion: 3,
      ...this.get_available_balance({ account_id }),
      settlements,
    };
  }

  @view({})
  get_risk() {
    return this.participants.toArray().map(([, p]) => {
      const available = this.get_available_balance({ account_id: p.accountId });
      const {
        grossPayable,
        grossReceivable,
        pendingIncoming,
        pendingOutgoing,
      } = this.participantExposure(p.accountId);
      return {
        accountId: p.accountId,
        name: p.name,
        balance: available.balance,
        creditLimit: (p.creditLimit ?? 0n).toString(),
        grossPayable: grossPayable.toString(),
        grossReceivable: grossReceivable.toString(),
        netPosition: (grossReceivable - grossPayable).toString(),
        collateralRequired: available.reservedCollateral,
        reservedPayable: available.reservedPayable,
        availableBalance: available.availableBalance,
        pendingPayable: pendingOutgoing
          .reduce((total, o) => total + BigInt(o.amount), 0n)
          .toString(),
        pendingReceivable: pendingIncoming
          .reduce((total, o) => total + BigInt(o.amount), 0n)
          .toString(),
        covered:
          BigInt(available.balance) >= BigInt(available.reservedCollateral),
        withdrawalsEnabled: available.withdrawalsEnabled,
        securityVersion: 3,
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Deposits & withdrawals (settlement currency = NEAR)               */
  /* ---------------------------------------------------------------- */

  @call({ payableFunction: true })
  deposit() {
    assert(
      this.security() !== null,
      "Start the security upgrade before depositing",
    );
    const accountId = near.predecessorAccountId();
    assert(this.participants.get(accountId) !== null, "Not registered");
    const attached = near.attachedDeposit();
    assert(attached > 0n, "Attach a deposit");
    const balance = this.balances.get(accountId) ?? 0n;
    assert(
      balance + attached <= MAX_AMOUNT,
      "Balance exceeds NEAR's amount range",
    );
    this.balances.set(accountId, balance + attached);
    return {
      accountId,
      deposited: attached.toString(),
      balance: (balance + attached).toString(),
    };
  }

  @call({ payableFunction: true })
  withdraw({ amount }: { amount: string }) {
    this.assertReady();
    const accountId = near.predecessorAccountId();
    assert(
      near.attachedDeposit() === 1n,
      "Attach exactly one yoctoNEAR to authorize withdrawal",
    );
    const amountBig = this.amount(amount);
    const balance = this.balances.get(accountId) ?? 0n;
    assert(
      balance >= amountBig,
      `Insufficient balance: have ${balance.toString()}, want ${amountBig.toString()}`,
    );
    assert(
      balance - amountBig >= this.collateral(accountId),
      "Withdrawal would spend reserved collateral",
    );
    this.balances.set(accountId, balance - amountBig);
    const rawSequence = near.storageRead("withdrawal_sequence");
    const sequence = rawSequence === null ? 1 : Number(rawSequence) + 1;
    near.storageWrite("withdrawal_sequence", String(sequence));
    this.store(`withdrawal:${sequence}`, {
      accountId,
      amount: amountBig.toString(),
    });
    const promise = near.promiseBatchCreate(accountId);
    near.promiseBatchActionTransfer(promise, amountBig);
    const callback = near.promiseThen(
      promise,
      near.currentAccountId(),
      "on_withdrawal_complete",
      JSON.stringify({ withdrawal_id: sequence }),
      0n,
      15_000_000_000_000n,
    );
    near.promiseReturn(callback);
  }

  @call({ privateFunction: true })
  on_withdrawal_complete({ withdrawal_id }: { withdrawal_id: number }) {
    assert(
      near.predecessorAccountId() === near.currentAccountId(),
      "Private withdrawal callback",
    );
    const pending = this.json<{ accountId: string; amount: string }>(
      `withdrawal:${withdrawal_id}`,
    );
    assert(
      pending !== null,
      "Withdrawal callback already completed or unknown",
    );
    assert(near.promiseResultsCount() === 1n, "Invalid withdrawal callback");
    let succeeded = true;
    try {
      near.promiseResult(0 as never);
    } catch {
      succeeded = false;
    }
    if (!succeeded)
      this.balances.set(
        pending.accountId,
        (this.balances.get(pending.accountId) ?? 0n) + BigInt(pending.amount),
      );
    near.storageRemove(`withdrawal:${withdrawal_id}`);
    return {
      accountId: pending.accountId,
      withdrawn: succeeded ? pending.amount : "0",
      refunded: !succeeded,
      balance: (this.balances.get(pending.accountId) ?? 0n).toString(),
    };
  }

  @view({})
  get_balance({ account_id }: { account_id: string }): string {
    return (this.balances.get(account_id) ?? 0n).toString();
  }

  @view({})
  get_available_balance({ account_id }: { account_id: string }) {
    const balance = this.balances.get(account_id) ?? 0n;
    const reserved = this.collateral(account_id);
    return {
      accountId: account_id,
      balance: balance.toString(),
      reservedCollateral: reserved.toString(),
      reservedPayable: this.reservedGross(account_id).toString(),
      availableBalance: (this.security()?.ready === true && balance > reserved
        ? balance - reserved
        : 0n
      ).toString(),
      withdrawalsEnabled: this.security()?.ready === true,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Obligations                                                       */
  /* ---------------------------------------------------------------- */

  @call({ payableFunction: true })
  record_obligation({
    debtor,
    creditor,
    amount,
    memo,
    due_at,
  }: {
    debtor: string;
    creditor: string;
    amount: string;
    memo: string;
    due_at: number | null;
  }) {
    this.assertReady();
    const caller = near.predecessorAccountId();
    validateAccountId(debtor);
    validateAccountId(creditor);
    assert(debtor !== creditor, "Debtor and creditor must differ");
    assert(
      caller === debtor || caller === creditor,
      "Only debtor or creditor can record",
    );
    assert(
      this.participants.get(debtor) !== null,
      `Debtor ${debtor} not registered`,
    );
    assert(
      this.participants.get(creditor) !== null,
      `Creditor ${creditor} not registered`,
    );
    const amountBig = this.amount(amount);
    assert(memo.length <= MAX_MEMO_LEN, `Memo too long (max ${MAX_MEMO_LEN})`);
    if (due_at !== null) {
      assert(
        Number.isSafeInteger(due_at) && due_at > 0 && due_at <= 253402300799999,
        "Invalid due_at",
      );
    }
    assert(
      near.attachedDeposit() ===
        STORAGE_BYTES_PER_OBLIGATION * near.storageByteCost(),
      "Attach the obligation storage deposit",
    );

    const id = `obl-${this.nextObligationId}`;
    this.nextObligationId += 1;
    this.totalObligations += 1;

    this.obligations.set(id, {
      id,
      debtor,
      creditor,
      amount: amountBig,
      memo,
      createdAt: nowMs(),
      dueAt: due_at,
      status: "pending",
    });
    this.store(`approval:${id}`, {
      proposer: caller,
      debtorApproved: caller === debtor,
      creditorApproved: caller === creditor,
      funded: false,
    } as Approval);
    this.addActive(id);
    return { id, status: "pending", requiresCounterpartyApproval: true };
  }

  @call({})
  accept_obligation({ obligation_id }: { obligation_id: string }) {
    assert(this.security() !== null, "Start the security upgrade first");
    const obl = this.obligations.get(obligation_id);
    const approval = this.approval(obligation_id);
    assert(
      obl !== null && approval !== null,
      "Obligation not found or legacy review has not reached this record",
    );
    const caller = near.predecessorAccountId();
    assert(
      caller === obl.debtor || caller === obl.creditor,
      "Only a bill's parties can approve it",
    );
    assert(
      obl.status === "pending" ||
        (approval.legacy && !approval.legacyFinalized),
      "Only pending obligations can be approved",
    );
    if (caller === obl.debtor) {
      assert(!approval.debtorApproved, "Debtor has already approved");
      approval.debtorApproved = true;
    } else {
      assert(!approval.creditorApproved, "Creditor has already approved");
      approval.creditorApproved = true;
    }
    if (this.approved(approval)) {
      this.tryFund(obl, approval);
      if (obl.status !== "disputed") this.addOpenId(obl.id);
    }
    this.obligations.set(obl.id, obl);
    this.store(`approval:${obl.id}`, approval);
    return this.dto(obl);
  }

  @call({})
  fund_obligation({ obligation_id }: { obligation_id: string }) {
    assert(this.security() !== null, "Start the security upgrade first");
    const obl = this.obligations.get(obligation_id);
    const approval = this.approval(obligation_id);
    assert(
      obl !== null && approval !== null && this.approved(approval),
      "Both parties must approve the bill first",
    );
    assert(
      near.predecessorAccountId() === obl.debtor,
      "Only the debtor may reserve collateral",
    );
    assert(
      !approval.funded &&
        (obl.status === "pending" ||
          (approval.legacy &&
            !approval.legacyFinalized &&
            (obl.status === "open" || obl.status === "disputed"))),
      "Obligation is already funded or terminal",
    );
    assert(
      this.tryFund(obl, approval),
      "Insufficient available collateral to fund the bill",
    );
    this.obligations.set(obl.id, obl);
    this.store(`approval:${obl.id}`, approval);
    return this.dto(obl);
  }

  @call({})
  reject_obligation({ obligation_id }: { obligation_id: string }) {
    this.assertReady();
    const obl = this.obligations.get(obligation_id);
    const approval = this.approval(obligation_id);
    assert(
      obl !== null && approval !== null && obl.status === "pending",
      "Only pending proposals can be rejected",
    );
    const caller = near.predecessorAccountId();
    assert(
      caller === obl.debtor || caller === obl.creditor,
      "Only a bill's parties may reject it",
    );
    assert(
      !this.approved(approval) && !approval.legacy,
      "Approved obligations require a bilateral cancellation",
    );
    obl.status = "voided";
    this.obligations.set(obl.id, obl);
    this.removeActive(obl.id);
    this.removeOpenId(obl.id);
    return this.dto(obl);
  }

  @call({})
  dispute({ obligation_id }: { obligation_id: string }) {
    assert(this.security() !== null, "Start the security upgrade first");
    const caller = near.predecessorAccountId();
    const obl = this.obligations.get(obligation_id);
    assert(obl !== null, "Obligation not found");
    assert(
      obl.debtor === caller || obl.creditor === caller,
      "Only debtor or creditor can dispute",
    );
    const approval = this.approval(obligation_id);
    assert(approval !== null, "Legacy review has not reached this record");
    assert(
      obl.status === "open" ||
        (obl.status === "pending" && this.approved(approval)),
      "Only approved obligations can be disputed",
    );
    obl.status = "disputed";
    obl.disputedBy = caller;
    this.obligations.set(obligation_id, obl);
    this.removeOpenId(obligation_id);
    return { obligation_id, status: "disputed" };
  }

  @call({})
  resolve_dispute({
    obligation_id,
    outcome,
  }: {
    obligation_id: string;
    outcome: "keep" | "void";
  }) {
    assert(this.security() !== null, "Start the security upgrade first");
    const caller = near.predecessorAccountId();
    const obl = this.obligations.get(obligation_id);
    assert(obl !== null, "Obligation not found");
    assert(
      obl.debtor === caller || obl.creditor === caller,
      "Only debtor or creditor can resolve",
    );
    assert(
      obl.status === "disputed",
      "Only disputed obligations can be resolved",
    );
    assert(
      outcome === "keep" || outcome === "void",
      "Outcome must be keep or void",
    );
    const approval = this.approval(obligation_id);
    assert(approval !== null, "Legacy review has not reached this record");
    assert(
      this.approved(approval) || outcome === "void",
      "Legacy terms must be approved before resuming a bill",
    );
    if (caller === obl.debtor) approval.debtorResolution = outcome;
    else approval.creditorResolution = outcome;
    const agreed =
      approval.debtorResolution === outcome &&
      approval.creditorResolution === outcome;
    if (agreed) {
      if (outcome === "keep") {
        obl.status = approval.funded ? "open" : "pending";
        obl.disputedBy = undefined;
        this.addOpenId(obligation_id);
      } else {
        if (approval.funded) this.changeReservation(obl.debtor, -obl.amount);
        approval.funded = false;
        obl.status = "voided";
        this.removeActive(obl.id);
        this.removeOpenId(obl.id);
        this.finalizeLegacy(approval);
      }
      approval.debtorResolution = undefined;
      approval.creditorResolution = undefined;
    }
    this.obligations.set(obligation_id, obl);
    this.store(`approval:${obl.id}`, approval);
    return { obligation_id, status: obl.status, awaitingCounterparty: !agreed };
  }

  @view({})
  get_obligation({
    obligation_id,
  }: {
    obligation_id: string;
  }): ObligationDTO | null {
    const obl = this.obligations.get(obligation_id);
    return obl === null ? null : this.dto(obl);
  }

  @view({})
  get_obligations({
    status,
    account_id,
    limit,
    start = 0,
  }: {
    status?: ObligationStatus;
    account_id?: string;
    limit?: number;
    start?: number;
  }): ObligationDTO[] {
    const max = Math.min(limit ?? 100, 500);
    assert(
      Number.isSafeInteger(max) &&
        max > 0 &&
        Number.isSafeInteger(start) &&
        start >= 0,
      "Invalid ledger range",
    );
    const live =
      status === "pending" || status === "open" || status === "disputed";
    // Archive pagination bounds the scanned storage slots. The SDK's keys()
    // does not clamp its limit and otherwise returns nulls past the final slot.
    const keys = live
      ? this.activeIds().slice(start)
      : this.obligations.keys({
          start,
          limit: Math.min(max, Math.max(0, this.obligations.length - start)),
        });
    const out: ObligationDTO[] = [];
    for (const id of keys) {
      if (out.length >= max) break;
      const obl = this.obligations.get(id);
      if (obl === null) continue;
      const dto = this.dto(obl);
      if (status && dto.status !== status) continue;
      if (
        account_id &&
        dto.debtor !== account_id &&
        dto.creditor !== account_id
      )
        continue;
      out.push(dto);
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Clearing                                                          */
  /* ---------------------------------------------------------------- */

  private eligibleObligations(includeNotDue: boolean): Obligation[] {
    const now = nowMs();
    const out: Obligation[] = [];
    for (const id of this.openIds()) {
      const obl = this.obligations.get(id);
      if (obl === null || (obl.status !== "open" && obl.status !== "pending"))
        continue;
      const approval = this.approval(id);
      if (
        !this.approved(approval) ||
        (approval?.legacy && !approval.legacyFinalized)
      )
        continue;
      if (obl.dueAt !== null && obl.dueAt > now && !includeNotDue) continue;
      out.push(obl);
    }
    return out;
  }

  private toDTO(result: ClearingResult): ClearingResultDTO {
    return {
      positions: result.positions.map((p) => ({
        accountId: p.accountId,
        net: p.net.toString(),
      })),
      transfers: result.transfers.map((t) => ({
        from: t.from,
        to: t.to,
        amount: t.amount.toString(),
      })),
      grossVolume: result.grossVolume.toString(),
      netVolume: result.netVolume.toString(),
      compression: result.compression,
      obligationCount: result.obligationCount,
      obligationIds: result.obligationIds,
    };
  }

  private plan(max: number, ids?: string[]) {
    assert(
      Number.isSafeInteger(max) && max > 0 && max <= 200,
      "Clearing batch must contain 1-200 obligations",
    );
    const eligible = this.eligibleObligations(false);
    let batch = eligible.slice(0, max);
    if (ids !== undefined) {
      assert(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= max &&
          new Set(ids).size === ids.length,
        "Invalid or duplicate clearing references",
      );
      const allowed = new Map(eligible.map((obl) => [obl.id, obl]));
      batch = ids.map((id) => {
        const obl = allowed.get(id);
        assert(
          obl !== undefined,
          "Only due, mutually approved bills may be cleared",
        );
        return obl;
      });
    }
    const result = clearObligations(
      batch.map((o) => ({
        id: o.id,
        debtor: o.debtor,
        creditor: o.creditor,
        amount: o.amount,
      })),
    );
    const released = new Map<string, bigint>();
    for (const obl of batch) {
      if (this.approval(obl.id)?.funded)
        released.set(obl.debtor, (released.get(obl.debtor) ?? 0n) + obl.amount);
    }
    const shortfalls: string[] = [];
    for (const position of result.positions) {
      const accountId = position.accountId;
      const balance = this.balances.get(accountId) ?? 0n;
      const netDebit = position.net < 0n ? -position.net : 0n;
      const remaining =
        this.reservedGross(accountId) - (released.get(accountId) ?? 0n);
      assert(remaining >= 0n, "Invalid collateral release");
      const requiredAfter =
        requiredCollateral(remaining, this.effectiveRatio()) +
        requiredCollateral(netDebit, this.effectiveRatio()) -
        netDebit;
      if (balance + position.net < requiredAfter)
        shortfalls.push(
          `${accountId} cannot settle without spending reserved collateral`,
        );
      if (balance + position.net < 0n)
        shortfalls.push(`${accountId} has insufficient settlement funds`);
      const participant = this.participants.get(accountId);
      if (
        (participant?.creditLimit ?? 0n) > 0n &&
        netDebit > participant!.creditLimit
      )
        shortfalls.push(`${accountId} exceeds its credit limit`);
    }
    return { eligible, batch, result, shortfalls };
  }

  @view({})
  get_clearing_obligations(): ObligationDTO[] {
    return this.eligibleObligations(true).map((obl) => this.dto(obl));
  }

  @view({})
  get_clear_preview({
    max_obligations = 10,
    obligation_ids,
  }: {
    max_obligations?: number;
    obligation_ids?: string[];
  }) {
    const plan = this.plan(max_obligations, obligation_ids);
    return {
      ...this.toDTO(plan.result),
      shortfalls: plan.shortfalls,
      ready:
        this.security()?.ready === true &&
        plan.batch.length > 0 &&
        plan.shortfalls.length === 0,
      remaining: plan.eligible.length - plan.batch.length,
    };
  }

  @view({})
  compute_net_positions({
    include_not_due,
  }: {
    include_not_due?: boolean;
  }): ClearingResultDTO {
    const eligible = this.eligibleObligations(include_not_due ?? false);
    const result = clearObligations(
      eligible.map((o) => ({
        id: o.id,
        debtor: o.debtor,
        creditor: o.creditor,
        amount: o.amount,
      })),
    );
    return this.toDTO(result);
  }

  @call({})
  clear({
    include_not_due,
    max_obligations = 10,
    obligation_ids,
  }: {
    include_not_due?: boolean;
    max_obligations?: number;
    obligation_ids?: string[];
  }) {
    this.assertReady();
    assert(
      include_not_due === undefined || include_not_due === false,
      "Scheduled obligations cannot be cleared before their due time",
    );
    const { eligible, batch, result, shortfalls } = this.plan(
      max_obligations,
      obligation_ids,
    );
    assert(batch.length > 0, "Nothing to clear");
    assert(
      shortfalls.length === 0,
      `Risk check failed: ${shortfalls.join("; ")}`,
    );

    // Apply transfers atomically.
    for (const t of result.transfers) {
      const fromBalance = this.balances.get(t.from) ?? 0n;
      const toBalance = this.balances.get(t.to) ?? 0n;
      this.balances.set(t.from, fromBalance - t.amount);
      this.balances.set(t.to, toBalance + t.amount);
    }

    // Mark obligations settled (iterate only the batch).
    for (const obl of batch) {
      const approval = this.approval(obl.id)!;
      if (approval.funded) this.changeReservation(obl.debtor, -obl.amount);
      approval.funded = false;
      this.store(`approval:${obl.id}`, approval);
      this.removeActive(obl.id);
      obl.status = "settled";
      this.obligations.set(obl.id, obl);
      this.removeOpenId(obl.id);
    }

    // Record the settlement round.
    const roundId = `round-${this.nextSettlementId}`;
    this.nextSettlementId += 1;
    this.totalSettledVolume += result.netVolume;
    const record: SettlementRecord = {
      id: roundId,
      timestamp: nowMs(),
      grossVolume: result.grossVolume,
      netVolume: result.netVolume,
      compression: result.compression,
      obligationCount: result.obligationCount,
      obligationIds: result.obligationIds,
      transfers: result.transfers,
    };
    this.settlements.set(roundId, record);

    return {
      roundId,
      remaining: eligible.length - batch.length,
      transfers: result.transfers.map((t) => ({
        from: t.from,
        to: t.to,
        amount: t.amount.toString(),
      })),
      grossVolume: result.grossVolume.toString(),
      netVolume: result.netVolume.toString(),
      compression: result.compression,
      obligationCount: result.obligationCount,
    };
  }

  @view({})
  get_settlements({ limit }: { limit?: number }): SettlementDTO[] {
    const max = Math.min(limit ?? 50, 200);
    assert(Number.isSafeInteger(max) && max > 0, "Invalid settlement limit");
    const count = Math.min(max, this.settlements.length);
    const keys = this.settlements.keys({
      start: this.settlements.length - count,
      limit: count,
    });
    return keys
      .map((id) => {
        const s = this.settlements.get(id)!;
        return {
          id: s.id,
          timestamp: s.timestamp,
          grossVolume: s.grossVolume.toString(),
          netVolume: s.netVolume.toString(),
          compression: s.compression,
          obligationCount: s.obligationCount,
          obligationIds: s.obligationIds,
          transfers: s.transfers.map((t) => ({
            from: t.from,
            to: t.to,
            amount: t.amount.toString(),
          })),
        };
      })
      .reverse();
  }

  /**
   * Maintenance: purge settled/voided obligations and old
   * settlement records to free storage. The contract pays for storage, so
   * history growth eventually starves it — this keeps it operational.
   * Only the owner may call it.
   */
  @call({})
  purge_history({ keep_settlements }: { keep_settlements?: number }) {
    this.assertReady();
    const caller = near.predecessorAccountId();
    assert(caller === this.ownerId, "Only the owner can purge history");

    // Purge non-open obligations.
    let purgedObligations = 0;
    for (const [id, obl] of this.obligations.toArray()) {
      if (obl.status === "settled" || obl.status === "voided") {
        this.obligations.remove(id);
        this.removeOpenId(id);
        purgedObligations += 1;
      }
    }

    // Keep the most recent `keep_settlements` settlement records.
    const keep = Math.max(1, Math.min(keep_settlements ?? 50, 200));
    const all = this.settlements.toArray().map(([id]) => id);
    const drop = all.length - keep;
    let purgedSettlements = 0;
    for (let i = 0; i < drop; i++) {
      this.settlements.remove(all[i]);
      purgedSettlements += 1;
    }

    return { purgedObligations, purgedSettlements };
  }

  @view({})
  get_stats() {
    const counts = { open: 0, pending: 0, disputed: 0 };
    for (const id of this.activeIds()) {
      const obl = this.obligations.get(id);
      if (obl === null) continue;
      const status = this.dto(obl).status;
      if (status === "open" || status === "pending" || status === "disputed")
        counts[status]++;
    }
    return {
      ownerId: this.ownerId,
      participantCount: this.participants.length,
      obligationCount: this.totalObligations,
      openObligations: counts.open,
      pendingObligations: counts.pending,
      disputedObligations: counts.disputed,
      settlementCount: this.settlements.length,
      totalSettledVolume: this.totalSettledVolume.toString(),
      securityVersion: 3,
      securityReady: this.security()?.ready === true,
    };
  }
}
