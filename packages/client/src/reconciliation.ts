import type {
  ParticipantProfile,
  ObligationDTO,
  RiskRow,
  SettlementDTO,
  StatementDTO,
  AvailableBalance,
} from "./index.js";

/** Reconcile public active obligations using the deployed collateral policy. */
export function reconcileRisk(
  participants: ParticipantProfile[],
  obligations: ObligationDTO[],
  limits: { accountId: string; creditLimit: string }[],
  ratio: number,
  balances: string[],
  available?: AvailableBalance[],
): RiskRow[] {
  const exposure = new Map<string, { payable: bigint; receivable: bigint }>();
  const active = obligations.filter((o) =>
    ["open", "pending", "disputed"].includes(o.status),
  );
  for (const participant of participants)
    exposure.set(participant.accountId, { payable: 0n, receivable: 0n });
  for (const obligation of active) {
    if (
      available
        ? !(
            obligation.funded &&
            obligation.debtorApproved &&
            obligation.creditorApproved &&
            ["open", "disputed"].includes(obligation.status)
          )
        : obligation.status !== "open"
    )
      continue;
    const debtor = exposure.get(obligation.debtor),
      creditor = exposure.get(obligation.creditor);
    if (debtor) debtor.payable += BigInt(obligation.amount);
    if (creditor) creditor.receivable += BigInt(obligation.amount);
  }
  return participants.map((participant, i) => {
    const { payable, receivable } = exposure.get(participant.accountId)!;
    const position = receivable - payable;
    const debit = position < 0n ? -position : 0n;
    const locked = available?.find(
      (row) => row.accountId === participant.accountId,
    );
    const required = locked
      ? BigInt(locked.reservedCollateral)
      : BigInt(Math.round(Number(debit) * ratio));
    return {
      accountId: participant.accountId,
      name: participant.name,
      balance: balances[i],
      creditLimit:
        limits.find((limit) => limit.accountId === participant.accountId)
          ?.creditLimit ?? "0",
      grossPayable: payable.toString(),
      grossReceivable: receivable.toString(),
      netPosition: position.toString(),
      collateralRequired: required.toString(),
      covered: BigInt(balances[i]) >= required,
      ...(locked
        ? {
            reservedPayable: locked.reservedPayable,
            availableBalance: locked.availableBalance,
            withdrawalsEnabled: locked.withdrawalsEnabled,
            pendingPayable: active
              .filter((o) => o.debtor === participant.accountId && !o.funded)
              .reduce((sum, o) => sum + BigInt(o.amount), 0n)
              .toString(),
            pendingReceivable: active
              .filter((o) => o.creditor === participant.accountId && !o.funded)
              .reduce((sum, o) => sum + BigInt(o.amount), 0n)
              .toString(),
            securityVersion: 3,
          }
        : {}),
    };
  });
}

export function reconcileStatement(
  accountId: string,
  participants: ParticipantProfile[],
  obligations: ObligationDTO[],
  rows: RiskRow[],
  rounds: SettlementDTO[],
): StatementDTO {
  const participant = participants.find((p) => p.accountId === accountId);
  const row = rows.find((r) => r.accountId === accountId);
  if (!participant || !row) throw new Error("Participant not found");
  const committed = (o: ObligationDTO) =>
    row.securityVersion === 3
      ? o.funded === true &&
        o.debtorApproved === true &&
        o.creditorApproved === true &&
        ["open", "disputed"].includes(o.status)
      : o.status === "open";
  return {
    accountId,
    name: participant.name,
    kind: participant.kind,
    balance: row.balance,
    creditLimit: row.creditLimit,
    grossPayable: row.grossPayable,
    grossReceivable: row.grossReceivable,
    netPosition: row.netPosition,
    openIncoming: obligations.filter(
      (o) => committed(o) && o.creditor === accountId,
    ),
    openOutgoing: obligations.filter(
      (o) => committed(o) && o.debtor === accountId,
    ),
    ...(row.securityVersion === 3
      ? {
          pendingIncoming: obligations.filter(
            (o) =>
              ["pending", "open", "disputed"].includes(o.status) &&
              !o.funded &&
              o.creditor === accountId,
          ),
          pendingOutgoing: obligations.filter(
            (o) =>
              ["pending", "open", "disputed"].includes(o.status) &&
              !o.funded &&
              o.debtor === accountId,
          ),
          reservedCollateral: row.collateralRequired,
          reservedPayable: row.reservedPayable,
          availableBalance: row.availableBalance,
          withdrawalsEnabled: row.withdrawalsEnabled,
          securityVersion: 3,
        }
      : {}),
    settlements: rounds
      .map((round) => ({
        id: round.id,
        timestamp: round.timestamp,
        netVolume: round.netVolume,
        compression: round.compression,
        transfers: round.transfers.filter(
          (t) => t.from === accountId || t.to === accountId,
        ),
      }))
      .filter((round) => round.transfers.length > 0),
  };
}
