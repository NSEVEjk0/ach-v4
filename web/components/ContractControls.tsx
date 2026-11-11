import { getSecurityConfig } from "@/lib/ach";

export default async function ContractControls() {
  try {
    const config = await getSecurityConfig();
    const protectedRules =
      config.version >= 3 &&
      config.bilateralApproval &&
      config.strictDueTimes &&
      config.reservedCollateral &&
      config.bilateralDisputes;
    const text = !config.ready
      ? "Contract review in progress. Withdrawals and clearing are paused while existing bills are reviewed; balances and history are retained."
      : protectedRules
        ? "Both parties approve each bill. Due times are enforced, committed funds stay reserved, and disputes need agreement from both parties."
        : "This testnet contract has no joint bill approval, enforced due times, reserved funds, or joint dispute resolution. Those protections are not active on this deployment.";
    return (
      <aside
        aria-label="Contract controls"
        className={`mt-4 rounded-xl border p-4 text-xs leading-relaxed ${protectedRules && config.ready ? "border-brand-100 bg-brand-50/50 text-brand-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}
      >
        <span className="mr-2 font-semibold">
          Testnet contract v{config.version}
        </span>
        {text}
      </aside>
    );
  } catch {
    return (
      <aside
        aria-label="Contract controls"
        className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
      >
        Contract controls could not be verified. Refresh data to try again.
      </aside>
    );
  }
}
