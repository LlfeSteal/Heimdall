// Test-only fixtures for the domain tests. Deliberately independent of the domain modules under test.
import { expect } from 'vitest'
import type { IterationReport, IterationState, Report, SeriesPoint } from '../api/types'

/** A series point; remaining defaults to committed − delivered. */
export function pt(date: string, committed: number, delivered: number, remaining = committed - delivered): SeriesPoint {
  return { date, committed, delivered, remaining }
}

/** `n` consecutive ISO dates starting at `start` (UTC arithmetic). */
export function days(start: string, n: number): string[] {
  const base = Date.parse(`${start}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10))
}

/** One ISO date `offset` days after `start`. */
export function day(start: string, offset: number): string {
  return days(start, offset + 1)[offset]
}

/** Points on consecutive days from `start` with the given remaining values and constant committed. */
export function burndown(start: string, remaining: number[], committed = 100): SeriesPoint[] {
  return days(start, remaining.length).map((d, i) => pt(d, committed, committed - remaining[i], remaining[i]))
}

export function makeReport(series: SeriesPoint[], committed: number, delivered: number, inProgress: number): Report {
  return {
    series,
    totals: {
      committed: { weight: committed, count: 0 },
      delivered: { weight: delivered, count: 0 },
      inProgress: { weight: inProgress, count: 0 },
    },
  }
}

let nextId = 1
export function makeIteration(p: {
  state?: IterationState
  startDate?: string | null
  dueDate?: string | null
  report?: Report | null
  id?: string
  iid?: string
}): IterationReport {
  const n = nextId++
  return {
    id: p.id ?? `gid://gitlab/Iteration/${n}`,
    iid: p.iid ?? String(n),
    title: `Iteration ${n}`,
    state: p.state ?? 'closed',
    startDate: p.startDate === undefined ? '2026-01-01' : p.startDate,
    dueDate: p.dueDate === undefined ? '2026-01-14' : p.dueDate,
    report: p.report === undefined ? null : p.report,
    reportError: null,
  }
}

/** Closed iteration whose only relevant data is its committed / delivered totals (§11.2). */
export function scored(committed: number, delivered: number, startDate = '2026-01-01'): IterationReport {
  return makeIteration({ state: 'closed', startDate, report: makeReport([], committed, delivered, 0) })
}

/** Element-wise comparison of nullable number arrays (null must match null; numbers to `digits`). */
export function expectValues(actual: readonly (number | null)[], expected: readonly (number | null)[], digits = 9): void {
  expect(actual.length, 'length').toBe(expected.length)
  expected.forEach((e, i) => {
    if (e === null) expect(actual[i], `index ${i}`).toBeNull()
    else {
      expect(actual[i], `index ${i}`).not.toBeNull()
      expect(actual[i] as number, `index ${i}`).toBeCloseTo(e, digits)
    }
  })
}

/** Deterministic PRNG (mulberry32) for property-style tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
