import { describe, expect, it } from 'vitest'
import { deliveryMetrics, deliverySummary, presentMetrics } from './metrics'
import { makeReport } from './testkit'

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
