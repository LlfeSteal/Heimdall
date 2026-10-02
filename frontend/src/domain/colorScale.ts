// Colour scales (SPEC §2.3, §11.3, §12) resolved by Amendment A.6: colours follow §2.3 exactly; the
// colour words in §15.3 are errata. Boundaries are INCLUSIVE as written below.

import { settle } from './stats'

export type Tone = 'good' | 'caution' | 'poor'

/**
 * Comparisons are made on the value rounded to 9 decimals so floating-point noise (e.g. a mean of three
 * 0.1 deviations = 10.000000000000002 %) cannot flip a boundary. Displayed numbers are not affected.
 */

/** Average / strip deviation, as a PERCENT v (fraction × 100): v ≤ 10 good · v ≤ 20 caution · else poor. */
export function deviationTone(percent: number): Tone {
  const v = settle(percent)
  return v <= 10 ? 'good' : v <= 20 ? 'caution' : 'poor'
}

/** Delivery difference in points, on |d|: |d| ≤ 2 good · |d| ≤ 5 caution · else poor. */
export function differenceTone(points: number): Tone {
  const d = settle(Math.abs(points))
  return d <= 2 ? 'good' : d <= 5 ? 'caution' : 'poor'
}

/** Compliant share, as a PERCENT s (higher is better): s ≥ 70 good · s ≥ 50 caution · else poor. */
export function compliantTone(percent: number): Tone {
  const s = settle(percent)
  return s >= 70 ? 'good' : s >= 50 ? 'caution' : 'poor'
}
