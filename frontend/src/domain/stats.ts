// Small statistics helpers shared by §8.3, §8.4 and §11.2.

/**
 * Median of `values` (input is NOT mutated). Odd count → middle value of the sorted copy; even count →
 * mean of the two middle values (§15.3: 21,24,40,45 → 32). Empty input → 0 (used by §8.4: no rates ⇒
 * velocity 0 ⇒ the trend branch).
 */
/** Rounds to 9 decimals so business thresholds are not flipped by floating-point noise (e.g. 0.9999999999999999). */
export function settle(x: number): number {
  return Math.round(x * 1e9) / 1e9
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Arithmetic mean; empty input → 0. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
