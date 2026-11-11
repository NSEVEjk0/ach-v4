export declare const YOCTO_PER_NEAR = 1000000000000000000000000n;
/** Round collateral upward using integer money arithmetic, including one yocto. */
export declare function requiredCollateral(amount: string | bigint, ratio: number): bigint;
/** Format ledger values without discarding sub-microNEAR precision. */
export declare function formatNear(yocto: string | bigint, minimumDecimals?: number): string;
/** Convert decimal NEAR amounts without rounding through floating-point math. */
export declare function nearToYocto(near: string | number): string;
