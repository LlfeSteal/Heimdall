import { describe, expect, it } from 'vitest'
import {
  closedForScore,
  COMPLIANT_THRESHOLD,
  NO_SCORE,
  predictability,
  PREDICTABILITY_WINDOW,
  presentScore,
  type PredictabilityScore,
} from './predictability'
import { makeIteration, makeReport, scored } from './testkit'

/** §15.3 conformance vector, newest first: (committed, delivered) = (50,45) (40,40) (30,24) (20,21). */
const vector = () => [scored(50, 45, '2026-04-01'), scored(40, 40, '2026-03-01'), scored(30, 24, '2026-02-01'), scored(20, 21, '2026-01-01')]

const score = (closed: ReturnType<typeof vector>) => {
  const s = predictability(closed)
  expect(s).not.toBe(NO_SCORE)
  return s as PredictabilityScore
}

describe('§11.2 constants', () => {
  it('window 4, compliant threshold 0.10', () => {
    expect(PREDICTABILITY_WINDOW).toBe(4)
    expect(COMPLIANT_THRESHOLD).toBe(0.1)
  })
})

describe('§15.3 full conformance vector', () => {
  it('numbers to the decimal', () => {
    const s = score(vector())
    expect(s.averageDeviation).toBeCloseTo(0.0875, 12) // a FRACTION
    expect(s.averageDifference).toBeCloseTo(2.5, 12) // SIGNED
    expect(s.medianVelocity).toBe(32) // median of delivered 21, 24, 40, 45
    expect(s.compliantShare).toBe(50) // only 0 and 0.05 are strictly under 0.10
    expect(s.analysedCount).toBe(4)
  })

  it('presentation: 8.8 % good · +2.5 pts caution · 50 % caution · 32.0 pts (A.6 colours)', () => {
    const p = presentScore(score(vector()))
    expect(p.averageDeviation).toEqual({ text: '8.8 %', tone: 'good' })
    expect(p.deliveryDiff).toEqual({ text: '+2.5 pts', tone: 'caution', caption: 'Under-delivered' })
    expect(p.compliant).toEqual({ text: '50 %', tone: 'caution' })
    expect(p.medianVelocity).toEqual({ text: '32.0 pts' })
    expect(p.analysed).toBe('4 sprints analyzed')
  })

  it('a fifth, 200-point outlier (older) is outside the window: count stays 4, median unaffected', () => {
    const list = [...vector(), scored(200, 200, '2025-12-01')]
    const closed = closedForScore(list)
    expect(closed).toHaveLength(4)
    expect(closed).toEqual(list.slice(0, 4))
    const s = score(closed)
    expect(s.analysedCount).toBe(4)
    expect(s.medianVelocity).toBe(32)
  })

  it('exactly 10 % is NOT compliant', () => {
    expect(score([scored(50, 45)]).compliantShare).toBe(0)
    expect(score([scored(100, 90)]).compliantShare).toBe(0)
    expect(score([scored(100, 110)]).compliantShare).toBe(0) // over-delivery by exactly 10 % too
    expect(score([scored(100, 91)]).compliantShare).toBe(100)
  })

  it('no closed iteration → closedForScore is empty (caller must not read) and the score is NO_SCORE', () => {
    const list = [makeIteration({ state: 'current' }), makeIteration({ state: 'upcoming' })]
    expect(closedForScore(list)).toEqual([])
    expect(closedForScore([])).toEqual([])
    expect(predictability([])).toBe(NO_SCORE)
  })
})

describe('§11.2 rules', () => {
  it('takes the closed iterations from the newest-first list, at most the first 4, skipping other states', () => {
    const a = scored(10, 10)
    const b = scored(10, 9)
    const c = scored(10, 8)
    const d = scored(10, 7)
    const e = scored(10, 6)
    const list = [makeIteration({ state: 'upcoming' }), a, makeIteration({ state: 'current' }), b, c, makeIteration({ state: 'x' }), d, e]
    expect(closedForScore(list)).toEqual([a, b, c, d])
    expect(closedForScore(list, 2)).toEqual([a, b])
  })

  it('skips iterations without a report or with committed ≤ 0 — without back-filling from older ones', () => {
    const list = [
      scored(50, 45),
      makeIteration({ state: 'closed', report: null }),
      scored(0, 5),
      scored(40, 40),
      scored(30, 24), // 5th closed — outside the window
    ]
    const s = score(closedForScore(list))
    expect(s.analysedCount).toBe(2)
    expect(s.averageDeviation).toBeCloseTo(0.05, 12)
  })

  it('nothing recordable → NO_SCORE (a distinct state, not zero)', () => {
    const r = predictability([makeIteration({ state: 'closed', report: null }), scored(0, 0)])
    expect(r).toBe(NO_SCORE)
    expect(typeof r).toBe('symbol')
  })

  it('difference keeps its sign; deviation is unsigned; caption Over-delivered when negative', () => {
    const s = score([scored(20, 21)])
    expect(s.averageDifference).toBe(-1)
    expect(s.averageDeviation).toBeCloseTo(0.05, 12)
    const p = presentScore(s)
    expect(p.deliveryDiff).toEqual({ text: '-1.0 pts', tone: 'good', caption: 'Over-delivered' })
  })

  it('a zero difference is captioned Under-delivered and shown +0.0', () => {
    const p = presentScore(score([scored(40, 40)]))
    expect(p.deliveryDiff.caption).toBe('Under-delivered')
    expect(p.deliveryDiff.text).toBe('+0.0 pts')
  })

  it('median velocity is the median of DELIVERED (not committed, not remaining)', () => {
    expect(score([scored(10, 2), scored(10, 4), scored(100, 6)]).medianVelocity).toBe(4)
  })

  it('uses the report totals (weights), not the series', () => {
    const iteration = makeIteration({ state: 'closed', report: makeReport([], 80, 60, 5) })
    const s = score([iteration])
    expect(s.averageDifference).toBe(20)
    expect(s.medianVelocity).toBe(60)
  })

  it('one analysed sprint is labelled in the singular', () => {
    expect(presentScore(score([scored(40, 40)])).analysed).toBe('1 sprint')
  })

  it('tones follow §2.3 / A.6 at the boundaries', () => {
    // avg deviation exactly 10 % → good; diff exactly 5 → caution; 0 % compliant → poor
    const p = presentScore(score([scored(50, 45)]))
    expect(p.averageDeviation).toEqual({ text: '10.0 %', tone: 'good' })
    expect(p.deliveryDiff.tone).toBe('caution')
    expect(p.compliant).toEqual({ text: '0 %', tone: 'poor' })
    const q = presentScore(score([scored(100, 79)])) // 21 % deviation, diff 21
    expect(q.averageDeviation.tone).toBe('poor')
    expect(q.deliveryDiff.tone).toBe('poor')
  })
})
