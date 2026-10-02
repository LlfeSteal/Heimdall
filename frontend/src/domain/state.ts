// Iteration-state semantics (SPEC §5.3, §9, ledger #17).
// Only `upcoming` and `closed` carry meaning; every other value — including an unknown or missing
// state — is a live, in-flight iteration.
import type { IterationState } from '../api/types'

/** True only for the exact state `closed`. */
export function isClosed(state: IterationState | null | undefined): boolean {
  return state === 'closed'
}

/** `!isClosed(state)`: `current`, unknown strings, `null` and `undefined` are all live (§9, ledger #17). */
export function isLive(state: IterationState | null | undefined): boolean {
  return !isClosed(state)
}
