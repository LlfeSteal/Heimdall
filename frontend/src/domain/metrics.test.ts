import { describe, expect, it } from 'vitest'
import { deliveryMetrics, deliverySummary, iterationMetrics, presentMetrics } from './metrics'
import { makeReport, pt } from './testkit'

describe('§12 delivery metrics strip', () => {
  it('deviation = |committed − delivered| / committed × 100; difference = committed − delivered', () => {
    expect(deliveryMetrics(makeReport([], 50, 45, 3))).toEqual({ committed: 50, delivered: 45, deviation: 10, difference: 5 })
  })

  it('committed 0 → deviation 0', () => {
    expect(deliveryMetrics(makeReport([], 0, 3, 0))).toEqual({ committed: 0, delivered: 3, deviation: 0, difference: -3 })
  })

  it('renders "Deviation: {1 decimal}%" and "Diff: {signed 1 decimal} pts" with A.6 tones', () => {
    expect(presentMetrics(deliveryMetrics(makeReport([], 50, 45, 3)))).toEqual({
      deviationText: 'Deviation: 10.0%',
      deviationTone: 'good',
      diffText: 'Diff: +5.0 pts',
      diffTone: 'caution',
    })
    expect(presentMetrics(deliveryMetrics(makeReport([], 40, 46, 0)))).toEqual({
      deviationText: 'Deviation: 15.0%',
      deviationTone: 'caution',
      diffText: 'Diff: -6.0 pts',
      diffTone: 'poor',
    })
    expect(presentMetrics(deliveryMetrics(makeReport([], 0, 3, 0)))).toEqual({
      deviationText: 'Deviation: 0.0%',
      deviationTone: 'good',
      diffText: 'Diff: -3.0 pts',
      diffTone: 'caution',
    })
  })
})

describe('§3.2 delivery summary strip', () => {
  it('percentages of committed, whole-number shares, one-decimal "… of …" pairs', () => {
    expect(deliverySummary(makeReport([], 50, 45, 3))).toEqual({
      completedPercent: 90,
      inProgressPercent: 6,
      completedShare: '90%',
      inProgressShare: '6%',
      completedOf: '45.0 of 50.0',
      inProgressOf: '3.0 of 50.0',
    })
  })

  it('shares are rounded', () => {
    const s = deliverySummary(makeReport([], 3, 2, 1))
    expect(s.completedPercent).toBeCloseTo(66.667, 3)
    expect(s.completedShare).toBe('67%')
    expect(s.inProgressShare).toBe('33%')
  })

  it('committed 0 → percentages 0', () => {
    const s = deliverySummary(makeReport([], 0, 2, 1))
    expect(s.completedPercent).toBe(0)
    expect(s.inProgressPercent).toBe(0)
    expect(s.completedShare).toBe('0%')
    expect(s.completedOf).toBe('2.0 of 0.0')
  })
})

describe('§12 open iterations are measured against the burndown Ideal on today', () => {
  // 40 pts over 03-02 → 03-06 (4 days): ideal remaining 40, 30, 20, 10, 0.
  const live = (todayRemaining: number) => ({
    state: 'current',
    dueDate: '2026-03-06',
    report: makeReport([pt('2026-03-02', 40, 0), pt('2026-03-03', 40, 5)], 40, 40 - todayRemaining, todayRemaining),
  })

  it('behind the ideal: Diff = actual − ideal remaining (positive), Deviation = |Diff| / committed', () => {
    // today 03-04: ideal 20, actual (today point = in-progress total) 26
    const m = iterationMetrics(live(26), '2026-03-04')
    expect(m.vsIdeal).toBe(true)
    expect(m.difference).toBe(6)
    expect(m.deviation).toBe(15)
  })

  it('ahead of the ideal: negative Diff', () => {
    const m = iterationMetrics(live(14), '2026-03-04')
    expect(m.difference).toBe(-6)
    expect(m.deviation).toBe(15)
    expect(presentMetrics(m).diffText).toBe('Diff: -6.0 pts')
  })

  it('closed iteration: final totals (committed − delivered), no "vs ideal"', () => {
    const closed = { ...live(26), state: 'closed' }
    expect(iterationMetrics(closed, '2026-03-04')).toEqual({ ...deliveryMetrics(closed.report), vsIdeal: false })
  })

  it('no recorded point yet: today\'s repaired point starts the ideal, so the iteration is on it (Diff 0)', () => {
    const fresh = { ...live(26), report: makeReport([], 40, 14, 26) }
    const m = iterationMetrics(fresh, '2026-03-04')
    expect(m.vsIdeal).toBe(true)
    expect(m.difference).toBe(0)
  })

  it('no committed workload → deviation 0', () => {
    const empty = { state: 'current', dueDate: '2026-03-06', report: makeReport([pt('2026-03-02', 0, 0)], 0, 0, 0) }
    expect(iterationMetrics(empty, '2026-03-04').deviation).toBe(0)
  })
})
