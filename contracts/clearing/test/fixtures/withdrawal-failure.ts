import { NearBindgen, call, near } from "near-sdk-js";

// Sandbox-only fault driver. The recipient disappears after the withdrawal
// request is queued, so its transfer fails after ACH records the withdrawal.
@NearBindgen({})
class WithdrawalFailureDriver {
  @call({ privateFunction: true })
  withdraw_and_delete({
    contract_id,
    amount,
    beneficiary_id,
  }: {
    contract_id: string;
    amount: string;
    beneficiary_id: string;
  }) {
    const withdrawal = near.promiseBatchCreate(contract_id);
    near.promiseBatchActionFunctionCall(
      withdrawal,
      "withdraw",
      JSON.stringify({ amount }),
      1n,
      150_000_000_000_000n,
    );
    const deletion = near.promiseBatchCreate(near.currentAccountId());
    near.promiseBatchActionDeleteAccount(deletion, beneficiary_id);
    near.promiseReturn(withdrawal);
  }
}
