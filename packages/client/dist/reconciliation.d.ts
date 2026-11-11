import type { ParticipantProfile, ObligationDTO, RiskRow, SettlementDTO, StatementDTO, AvailableBalance } from "./index.js";
/** Reconcile public active obligations using the deployed collateral policy. */
export declare function reconcileRisk(participants: ParticipantProfile[], obligations: ObligationDTO[], limits: {
    accountId: string;
    creditLimit: string;
}[], ratio: number, balances: string[], available?: AvailableBalance[]): RiskRow[];
export declare function reconcileStatement(accountId: string, participants: ParticipantProfile[], obligations: ObligationDTO[], rows: RiskRow[], rounds: SettlementDTO[]): StatementDTO;
