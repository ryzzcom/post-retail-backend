/**
 * Currency Conversion Utilities for Pakistani Rupee (PKR).
 * 1 PKR = 100 Paisas (Integer minor units).
 * All monetary amounts in database columns and internal math must use Paisas (BigInt).
 */

/**
 * Converts minor unit (paisas) to PKR rupees for display or external export.
 * @param paisa Amount in paisas (BigInt or number)
 * @returns Amount in standard PKR Rupees (e.g. 150050n -> 1500.5)
 */
export function paisaToRupees(paisa: bigint | number): number {
  if (typeof paisa === 'bigint') {
    return Number(paisa) / 100;
  }
  return Number(paisa) / 100;
}

/**
 * Converts PKR rupees to minor unit (paisas) for persistent storage and calculations.
 * Uses Math.round to protect against floating point noise (e.g. 19.99 * 100).
 * @param rupees Amount in PKR Rupees (e.g. 1500.5)
 * @returns Amount in paisas as BigInt (e.g. 150050n)
 */
export function rupeesToPaisa(rupees: number): bigint {
  if (isNaN(rupees) || !isFinite(rupees)) {
    throw new Error(`Invalid rupee amount provided for conversion: ${rupees}`);
  }
  return BigInt(Math.round(rupees * 100));
}
