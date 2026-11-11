export const YOCTO_PER_NEAR = 1000000000000000000000000n;
/** Round collateral upward using integer money arithmetic, including one yocto. */
export function requiredCollateral(amount, ratio) {
    const value = BigInt(amount);
    if (value < 0n || !Number.isFinite(ratio) || ratio < 0 || ratio > 10)
        throw new Error("Invalid collateral amount or ratio");
    const scaled = Math.round(ratio * 1_000_000);
    if (Math.abs(ratio - scaled / 1_000_000) > 1e-12)
        throw new Error("Collateral ratios support at most six decimal places");
    return (value * BigInt(scaled) + 999999n) / 1000000n;
}
/** Format ledger values without discarding sub-microNEAR precision. */
export function formatNear(yocto, minimumDecimals = 0) {
    const amount = BigInt(yocto);
    const magnitude = amount < 0n ? -amount : amount;
    const whole = (magnitude / YOCTO_PER_NEAR).toString();
    const fraction = (magnitude % YOCTO_PER_NEAR)
        .toString()
        .padStart(24, "0")
        .replace(/0+$/, "")
        .padEnd(Math.max(0, Math.min(24, minimumDecimals)), "0");
    return `${amount < 0n ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
}
/** Convert decimal NEAR amounts without rounding through floating-point math. */
export function nearToYocto(near) {
    const decimal = String(near).trim();
    const value = decimal.startsWith(".") ? "0" + decimal : decimal;
    const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
    if (!match)
        throw new Error("Enter a non-negative decimal NEAR amount");
    const fraction = match[2] ?? "";
    const exponent = Number(match[3] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
        throw new Error("NEAR amount is outside the supported range");
    }
    const digits = BigInt(match[1] + fraction);
    const scale = 24 + exponent - fraction.length;
    if (scale >= 0)
        return (digits * 10n ** BigInt(scale)).toString();
    const divisor = 10n ** BigInt(-scale);
    if (digits % divisor !== 0n)
        throw new Error("NEAR amounts support at most 24 decimal places");
    return (digits / divisor).toString();
}
