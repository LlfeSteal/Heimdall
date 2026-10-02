// Number and date formatting (SPEC §13, §11.3, §12, §15.3). Literals come from strings.ts.
// Minus sign is ASCII '-' (whatever Number#toFixed produces).
import { S } from '../strings'

/** Workload / points: one decimal. 32 → "32.0". */
export function oneDecimal(value: number): string {
  return value.toFixed(1)
}

/** Delivery difference: one decimal with an explicit '+' when ≥ 0. 2.5 → "+2.5", 0 → "+0.0", -1 → "-1.0". */
export function signedOneDecimal(value: number): string {
  // `-0 >= 0` is true and (-0).toFixed(1) is "0.0", so −0 renders "+0.0".
  return value >= 0 ? `+${oneDecimal(value)}` : oneDecimal(value)
}

/** Points with unit: `${oneDecimal(v)} pts` (unit = S.pts). 32 → "32.0 pts". */
export function formatPoints(value: number): string {
  return `${oneDecimal(value)} ${S.pts}`
}

/** Signed points with unit: `${signedOneDecimal(v)} pts`. 2.5 → "+2.5 pts". */
export function formatSignedPoints(value: number): string {
  return `${signedOneDecimal(value)} ${S.pts}`
}

/** Score-panel deviation percentage (input already ×100): one decimal + " %". 8.75 → "8.8 %". */
export function formatPercentOneDecimal(percent: number): string {
  return `${percent.toFixed(1)} %`
}

/** Score-panel compliant share: whole number (Math.round) + " %". 50 → "50 %". */
export function formatWholePercent(percent: number): string {
  return `${Math.round(percent)} %`
}

/** Delivery-summary share: whole number (Math.round) + "%" (no space). 66.6 → "67%". */
export function formatShare(percent: number): string {
  return `${Math.round(percent)}%`
}

/** §13 dates shown `start → due` (YYYY-MM-DD, verbatim). Delegates to `S.dateRange`. */
export function formatDateRange(start: string | null, due: string | null): string {
  return S.dateRange(start, due)
}
