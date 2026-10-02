import { describe, expect, it } from 'vitest'
import type { SeriesPoint } from '../api/types'
import {
  canonicalShape,
  closedExtension,
  dailyDirection,
  deviationPercent,
  forecastHistory,
  HISTORY_MAX,
  historicalRate,
  historySeries,
  lastForecastValue,
  NOT_USABLE,
  sample,
  SHAPE_COLLAPSE_EPSILON,
  SHAPE_GRID_POINTS,
  selectForecast,
  shapeForecast,
  shapeOf,
  TREND_WINDOW,
  velocityForecast,
} from './forecast'
import { burndown, days, expectValues, makeIteration, makeReport, pt, rng } from './testkit'

/** A past iteration burning 100 → 0 linearly over 11 daily points (10 points/day). */
const linear = () => burndown('2026-01-05', [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0])
/** A past iteration where nothing is ever delivered: shape y ≡ 1, rate 0. */
const flat = () => burndown('2026-01-05', [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100])
/** Unusable for shaping (fewer than 2 days with committed workload). */
const unusable = () => [pt('2026-01-05', 0, 0), pt('2026-01-06', 0, 0)]

describe('constants (§2.3)', () => {
  it('windows and grid', () => {
    expect(TREND_WINDOW).toBe(5)
    expect(HISTORY_MAX).toBe(4)
    expect(SHAPE_GRID_POINTS).toBe(21)
    expect(SHAPE_COLLAPSE_EPSILON).toBe(0.000000001)
  })
})

describe('§8.2 dailyDirection', () => {
  it('uses only the last 5 points: mean of point-to-point changes', () => {
    expect(dailyDirection(burndown('2026-03-01', [100, 0, 50, 40, 30, 20, 10]))).toBe(-10)
    expect(dailyDirection(burndown('2026-03-01', [10, 30, 20, 25, 5]))).toBe(-1.25)
  })

  it('a curve that went UP over the window is flat (0), never positive', () => {
    expect(dailyDirection(burndown('2026-03-01', [10, 12, 15]))).toBe(0)
    expect(dailyDirection(burndown('2026-03-01', [50, 10, 12, 30, 31, 35]))).toBe(0)
  })

  it('fewer than 2 points → 0', () => {
    expect(dailyDirection([])).toBe(0)
    expect(dailyDirection(burndown('2026-03-01', [7]))).toBe(0)
  })

  it('two points', () => {
    expect(dailyDirection(burndown('2026-03-01', [10, 4]))).toBe(-6)
  })

  it('custom window', () => {
    const s = burndown('2026-03-01', [100, 80, 70, 65, 61])
    expect(dailyDirection(s, 3)).toBe(-4.5)
    expect(dailyDirection(s)).toBe(-9.75)
  })

  it('changes are per point, not per calendar day', () => {
    expect(dailyDirection([pt('2026-03-01', 10, 0), pt('2026-03-05', 10, 8)])).toBe(-8)
  })
})

describe('§8.3 shapeOf', () => {
  it('drops zero-committed days, uses unfiltered first/last dates, divides by THAT day\'s committed, floors at 0', () => {
    const s = [
      pt('2026-03-01', 0, 0, 0),
      pt('2026-03-02', 10, 2, 8),
      pt('2026-03-03', 10, 5, 5),
      pt('2026-03-04', 20, 22, -2),
      pt('2026-03-05', 0, 0, 0),
    ]
    const shape = shapeOf(s)!
    expect(shape.map((p) => p.f)).toEqual([0.25, 0.5, 0.75])
    expectValues(shape.map((p) => p.y), [0.8, 0.5, 0])
    expect(Object.is(shape[2].y, -0)).toBe(false)
  })

  it('is immune to scope added mid-iteration (per-day committed)', () => {
    const shape = shapeOf([pt('2026-03-01', 10, 0, 10), pt('2026-03-02', 20, 10, 10), pt('2026-03-03', 20, 20, 0)])!
    expectValues(shape.map((p) => p.y), [1, 0.5, 0])
  })

  it('sorts by f ascending', () => {
    const shape = shapeOf([
      pt('2026-03-01', 10, 0, 10),
      pt('2026-03-03', 10, 5, 5),
      pt('2026-03-02', 10, 2, 8),
      pt('2026-03-05', 10, 10, 0),
    ])!
    expect(shape.map((p) => p.f)).toEqual([0, 0.25, 0.5, 1])
    expectValues(shape.map((p) => p.y), [1, 0.8, 0.5, 0])
  })

  it('clamps f into [0, 1]', () => {
    const shape = shapeOf([pt('2026-03-02', 10, 2, 8), pt('2026-03-01', 10, 0, 10), pt('2026-03-05', 10, 10, 0)])!
    expect(shape.map((p) => p.f)).toEqual([0, 0, 1])
    expect(shape.slice(0, 2).map((p) => p.y).sort()).toEqual([0.8, 1])
  })

  it('fewer than 2 non-zero-committed days → no shape', () => {
    expect(shapeOf([pt('2026-03-01', 0, 0), pt('2026-03-02', 10, 0), pt('2026-03-03', 0, 0)])).toBeNull()
    expect(shapeOf([])).toBeNull()
  })

  it('end ≤ start → no shape', () => {
    expect(shapeOf([pt('2026-03-01', 10, 0), pt('2026-03-01', 10, 5)])).toBeNull()
  })
})

describe('§8.3 sample', () => {
  const tri = [
    { f: 0, y: 1 },
    { f: 0.5, y: 0.5 },
    { f: 1, y: 0 },
  ]

  it('interpolates linearly and is flat beyond both ends', () => {
    expect(sample(tri, 0.25)).toBeCloseTo(0.75, 12)
    expect(sample(tri, 0.75)).toBeCloseTo(0.25, 12)
    expect(sample(tri, -1)).toBe(1)
    expect(sample(tri, 2)).toBe(0)
    expect(sample(tri, 0)).toBe(1)
    expect(sample(tri, 1)).toBe(0)
  })

  it('empty → 0; single point → its value everywhere', () => {
    expect(sample([], 0.3)).toBe(0)
    expect(sample([{ f: 0.5, y: 0.4 }], 0)).toBe(0.4)
    expect(sample([{ f: 0.5, y: 0.4 }], 1)).toBe(0.4)
  })

  it('a zero-width segment contributes no slope (no NaN, no Infinity)', () => {
    const step = [
      { f: 0, y: 1 },
      { f: 0.5, y: 0.8 },
      { f: 0.5, y: 0.4 },
      { f: 1, y: 0 },
    ]
    expect(sample(step, 0.25)).toBeCloseTo(0.9, 12)
    expect(sample(step, 0.75)).toBeCloseTo(0.2, 12)
    const atJump = sample(step, 0.5)
    expect(Number.isFinite(atJump)).toBe(true)
    expect([0.8, 0.4]).toContain(atJump)
    const degenerate = [
      { f: 0.5, y: 1 },
      { f: 0.5, y: 0.2 },
    ]
    expect(sample(degenerate, 0.5)).toBe(1)
    expect(sample(degenerate, 0.7)).toBe(0.2)
  })
})

describe('§8.3 canonicalShape', () => {
  const grid = Array.from({ length: 21 }, (_, i) => i / 20)

  it('returns a 21-point grid f = 0, 0.05, …, 1', () => {
    const c = canonicalShape([linear(), linear()])!
    expect(c).toHaveLength(21)
    c.forEach((p, i) => expect(p.f).toBeCloseTo(i / 20, 12))
    expectValues(c.map((p) => p.y), grid.map((f) => 1 - f))
  })

  it('no history / no usable shape → no shape', () => {
    expect(canonicalShape([])).toBeNull()
    expect(canonicalShape([unusable(), unusable()])).toBeNull()
  })

  it('uses the MEDIAN, so one abnormal iteration cannot drag it', () => {
    const c = canonicalShape([linear(), flat(), linear()])!
    expectValues(c.map((p) => p.y), grid.map((f) => 1 - f))
  })

  it('median of an even count averages the two middle shapes', () => {
    const half = burndown('2026-01-05', [50, 50, 50], 100) // y ≡ 0.5
    const c = canonicalShape([flat(), half])!
    expectValues(c.map((p) => p.y), grid.map(() => 0.75))
  })

  it('running minimum: the canonical curve never rises', () => {
    const rising = [pt('2026-01-01', 10, 8, 2), pt('2026-01-11', 10, 2, 8)] // y 0.2 → 0.8
    const c = canonicalShape([rising])!
    expectValues(c.map((p) => p.y), grid.map(() => 0.2))
  })

  it('takes only the first 4 history iterations (newest first)', () => {
    // first four: median of (1−f, 1−f, 1, 1) = 1 − f/2. Including the 5th (linear) would give 1 − f.
    const c = canonicalShape([linear(), linear(), flat(), flat(), linear()])!
    expectValues(c.map((p) => p.y), grid.map((f) => 1 - f / 2))
    const one = canonicalShape([flat(), linear()], 1)!
    expectValues(one.map((p) => p.y), grid.map(() => 1))
  })

  it('slices the first 4 BEFORE discarding unusable shapes', () => {
    expect(canonicalShape([unusable(), unusable(), unusable(), unusable(), linear()])).toBeNull()
  })
})

describe('§8.3 / §15.5 shapeForecast', () => {
  const axis = days('2026-03-01', 11) // day 1 … day 11 (due date)
  const upToToday = (todayRemaining: number) => burndown('2026-03-01', [100, 90, 80, 70, 60, todayRemaining])

  it('§15.5: today 50 on day 6 of 11 → exactly 50 today, day 8 ≈ 30, due date ≈ 0', () => {
    const r = shapeForecast(upToToday(50), [linear(), linear()], axis, 5, 10)
    expect(r).not.toBe(NOT_USABLE)
    const v = r as (number | null)[]
    expect(v).toHaveLength(11)
    expect(v[5]).toBe(50)
    expect(v[7] as number).toBeCloseTo(30, 6)
    expect(v[10] as number).toBeCloseTo(0, 6)
    expectValues(v, [null, null, null, null, null, 50, 40, 30, 20, 10, 0], 6)
  })

  it('§15.5: today 40 → day 8 ≈ 24, due date ≈ 0 (proportional scaling)', () => {
    const v = shapeForecast(upToToday(40), [linear(), linear()], axis, 5, 10) as (number | null)[]
    expect(v[5]).toBe(40)
    expect(v[7] as number).toBeCloseTo(24, 6)
    expect(v[10] as number).toBeCloseTo(0, 6)
  })

  it('§15.5: today 0 → every remaining day is 0 (even without history)', () => {
    expectValues(shapeForecast(upToToday(0), [linear()], axis, 5, 10) as (number | null)[], [
      null, null, null, null, null, 0, 0, 0, 0, 0, 0,
    ])
    expectValues(shapeForecast(upToToday(0), [], axis, 5, 10) as (number | null)[], [
      null, null, null, null, null, 0, 0, 0, 0, 0, 0,
    ])
  })

  it('negative today keeps its real value; everything after is 0', () => {
    const v = shapeForecast(upToToday(-3), [], axis, 5, 10) as (number | null)[]
    expect(v[5]).toBe(-3)
    expectValues(v.slice(6), [0, 0, 0, 0, 0])
  })

  it('§15.5: no history at all → declines with NOT_USABLE (not an array)', () => {
    const r = shapeForecast(upToToday(50), [], axis, 5, 10)
    expect(r).toBe(NOT_USABLE)
    expect(Array.isArray(r)).toBe(false)
  })

  it('declines for an invalid todayIndex', () => {
    const s = upToToday(50)
    const h = [linear()]
    expect(shapeForecast(s, h, axis, -1, 10)).toBe(NOT_USABLE)
    expect(shapeForecast(s, h, axis, 1.5, 10)).toBe(NOT_USABLE)
    expect(shapeForecast(s, h, axis, Number.NaN, 10)).toBe(NOT_USABLE)
    expect(shapeForecast(s, h, axis, 10, 10)).toBe(NOT_USABLE) // at endIndex
    expect(shapeForecast(s, h, axis, 11, 10)).toBe(NOT_USABLE) // beyond endIndex
    expect(shapeForecast(s, h, ['2026-03-01'], 5, 10)).toBe(NOT_USABLE) // no axis entry there
  })

  it('declines when no point is dated axis[todayIndex]', () => {
    expect(shapeForecast(burndown('2026-03-01', [100, 90, 80]), [linear()], axis, 5, 10)).toBe(NOT_USABLE)
  })

  it('declines when the canonical shape had already collapsed to zero at today', () => {
    const collapsing = burndown('2026-01-05', [100, 80, 60, 40, 20, 0, 0, 0, 0, 0, 0])
    const series = burndown('2026-03-01', [100, 90, 80, 70, 60, 50, 40, 10])
    expect(shapeForecast(series, [collapsing], axis, 7, 10)).toBe(NOT_USABLE)
  })

  it('declines when shapeToday is positive but ≤ 1e-9, and answers just above it', () => {
    const nearlyDone = (rest: number) => [pt('2026-01-05', 100, 0), pt('2026-01-10', 100, 100 - rest), pt('2026-01-15', 100, 100 - rest)]
    const series = burndown('2026-03-01', [100, 90, 80, 70, 60, 50])
    // today = axis[5] → elapsed fraction 0.5 → canonical shape value there = rest / 100
    expect(shapeForecast(series, [nearlyDone(5e-8)], axis, 5, 10)).toBe(NOT_USABLE) // 5e-10
    expect(Array.isArray(shapeForecast(series, [nearlyDone(2e-7)], axis, 5, 10))).toBe(true) // 2e-9
  })

  it('declines when end ≤ start', () => {
    const series = [pt('2026-03-05', 20, 10), pt('2026-03-03', 20, 0)]
    expect(shapeForecast(series, [linear()], ['2026-03-03', '2026-03-04', '2026-03-05'], 0, 2)).toBe(NOT_USABLE)
  })

  describe('§8.3 guarantees (property-style, deterministic PRNG)', () => {
    type Case = { series: SeriesPoint[]; history: SeriesPoint[][]; axis: string[]; todayIndex: number; endIndex: number }
    const cases: Case[] = []
    const rand = rng(20261001)
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
    for (let k = 0; k < 200; k++) {
      const history = Array.from({ length: int(1, 5) }, () => {
        const len = int(4, 15)
        let committed = int(20, 200)
        let remaining = committed
        return days('2025-11-03', len).map((d, i) => {
          if (i > 0) {
            if (rand() < 0.2) {
              const added = int(0, 20)
              committed += added
              remaining += added
            }
            remaining = Math.max(committed * 0.05, remaining - rand() * (committed / len) * 1.5)
          }
          return pt(d, committed, committed - remaining, remaining)
        })
      })
      const n = int(6, 20)
      const axis = days('2026-03-02', n)
      const todayIndex = int(1, n - 2)
      const series = axis.slice(0, todayIndex + 1).map((d, i) => pt(d, 100, i * 3, 100 - i * 3 - (i === todayIndex ? rand() * 20 : 0)))
      cases.push({ series, history, axis, todayIndex, endIndex: n - 1 })
    }
    const run = (c: Case, series = c.series) => shapeForecast(series, c.history, c.axis, c.todayIndex, c.endIndex)
    const usable = () => cases.filter((c) => run(c) !== NOT_USABLE)

    it('the generated cases are overwhelmingly usable', () => {
      expect(usable().length).toBeGreaterThan(150)
    })

    it('1. passes EXACTLY through today\'s real value; nothing before today', () => {
      for (const c of usable()) {
        const v = run(c) as (number | null)[]
        expect(v).toHaveLength(c.endIndex + 1)
        expect(v[c.todayIndex]).toBe(c.series[c.todayIndex].remaining)
        for (let i = 0; i < c.todayIndex; i++) expect(v[i]).toBeNull()
      }
    })

    it('2. is monotonically non-increasing from today on', () => {
      for (const c of usable()) {
        const v = run(c) as number[]
        for (let i = c.todayIndex + 1; i <= c.endIndex; i++) expect(v[i]).toBeLessThanOrEqual(v[i - 1] + 1e-12)
      }
    })

    it('3. never above today\'s remaining, never below zero', () => {
      for (const c of usable()) {
        const v = run(c) as number[]
        const today = c.series[c.todayIndex].remaining
        for (let i = c.todayIndex + 1; i <= c.endIndex; i++) {
          expect(v[i]).toBeGreaterThanOrEqual(0)
          expect(v[i]).toBeLessThanOrEqual(today)
        }
      }
    })

    it('4. scales with commitment: twice the remaining work ⇒ every projected value doubles', () => {
      for (const c of usable()) {
        const doubled = c.series.map((p) => ({ ...p, committed: p.committed * 2, delivered: p.delivered * 2, remaining: p.remaining * 2 }))
        const a = run(c) as number[]
        const b = run(c, doubled) as number[]
        for (let i = c.todayIndex; i <= c.endIndex; i++) expect(b[i]).toBeCloseTo(a[i] * 2, 9)
      }
    })

    it('5. an iteration already finished projects zeros for the rest of the axis', () => {
      for (const c of cases) {
        const finished = c.series.map((p, i) => (i === c.todayIndex ? { ...p, remaining: 0 } : p))
        const v = run(c, finished) as number[]
        expect(Array.isArray(v)).toBe(true)
        for (let i = c.todayIndex; i <= c.endIndex; i++) expect(v[i]).toBe(0)
      }
    })
  })
})

describe('§8.4 / §15.4 velocityForecast', () => {
  it('§15.4: history 10/day, own direction −5, today 30 → rates [10, 5], median 7.5 → 22.5, 15, 7.5', () => {
    const series = burndown('2026-03-01', [50, 45, 40, 35, 30])
    expectValues(velocityForecast(series, [linear()], 4, 7), [null, null, null, null, 30, 22.5, 15, 7.5])
  })

  it('§15.4: a team burning only 5/day against 40 remaining is still ABOVE zero at the due date', () => {
    const series = burndown('2026-03-01', [60, 55, 50, 45, 40])
    const v = velocityForecast(series, [], 4, 11)
    expectValues(v, [null, null, null, null, 40, 35, 30, 25, 20, 15, 10, 5])
    expect(v[11] as number).toBeGreaterThan(0)
  })

  it('§15.4: a forecast value is never negative (floored at 0)', () => {
    const v = velocityForecast(burndown('2026-03-01', [60, 55, 50, 45, 40]), [], 4, 13)
    expectValues(v.slice(12), [0, 0])
    for (const x of v) if (x !== null) expect(x).toBeGreaterThanOrEqual(0)
    expect(Object.is(v[13], -0)).toBe(false)
  })

  it('idle (zero-rate) history iterations are discarded before the median', () => {
    // rates: flat → 0 (discarded), linear → 10, own → 5 ⇒ median(10, 5) = 7.5 (not median(0,10,5) = 5)
    const series = burndown('2026-03-01', [50, 45, 40, 35, 30])
    expectValues(velocityForecast(series, [flat(), linear()], 4, 5), [null, null, null, null, 30, 22.5])
  })

  it('uses only the first 4 history iterations', () => {
    const fast = () => burndown('2026-01-05', [100, 80, 60, 40, 20, 0]) // 20/day
    const slow = () => burndown('2026-01-05', [100, 98, 96, 94, 92, 90]) // 2/day
    const series = burndown('2026-03-01', [30, 30, 30]) // own rate 0 → not blended
    // first four: median(20, 20, 2, 2) = 11; with the 5th it would be median(20,20,2,2,2) = 2
    expectValues(velocityForecast(series, [fast(), fast(), slow(), slow(), slow()], 2, 5), [null, null, 30, 19, 8, 0])
  })

  it('history iterations with fewer than 2 points contribute no rate', () => {
    const series = burndown('2026-03-01', [50, 45, 40, 35, 30])
    expectValues(velocityForecast(series, [[pt('2026-01-05', 100, 50)], linear()], 4, 5), [null, null, null, null, 30, 22.5])
  })

  it('no history and a flat or rising curve → today\'s value extended flat', () => {
    expectValues(velocityForecast(burndown('2026-03-01', [30, 30, 30]), [], 2, 5), [null, null, 30, 30, 30, 30])
    expectValues(velocityForecast(burndown('2026-03-01', [20, 25, 30]), [], 2, 4), [null, null, 30, 30, 30])
  })

  it('returns an EMPTY array (distinct from NOT_USABLE) for an invalid todayIndex', () => {
    const s = burndown('2026-03-01', [50, 45, 40])
    for (const [t, e] of [
      [-1, 7],
      [7, 7],
      [8, 7],
      [1.5, 7],
    ]) {
      const r = velocityForecast(s, [], t, e)
      expect(Array.isArray(r)).toBe(true)
      expect(r).toEqual([])
      expect(r).not.toBe(NOT_USABLE)
    }
  })

  it('today = series[todayIndex] by POSITION; absent → the all-null array (not empty)', () => {
    expect(velocityForecast(burndown('2026-03-01', [50, 45, 40]), [], 4, 7)).toEqual(Array(8).fill(null))
  })

  it('historicalRate', () => {
    expect(historicalRate(linear())).toBe(10)
    expect(historicalRate(flat())).toBe(0)
    expect(historicalRate([pt('2026-01-01', 10, 8), pt('2026-01-02', 10, 2)])).toBe(0) // negative → 0
    expect(historicalRate([pt('2026-01-01', 10, 8)])).toBeNull()
    expect(historicalRate([])).toBeNull()
  })
})

describe('§8.1 closed-iteration straight-line extension', () => {
  it('continues the last observed daily direction in calendar days, floored at 0', () => {
    const series = burndown('2026-03-01', [20, 18, 16, 14, 12])
    expectValues(closedExtension(series, days('2026-03-01', 13)), [null, null, null, null, 12, 10, 8, 6, 4, 2, 0, 0, 0])
  })

  it('counts calendar days, not axis positions', () => {
    const series = burndown('2026-03-01', [20, 18, 16])
    expectValues(closedExtension(series, ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05']), [null, null, 16, 12])
  })

  it('never negative, including at the last recorded point (§2.3 "a forecast never goes negative")', () => {
    expectValues(closedExtension(burndown('2026-03-01', [2, 0, -2]), days('2026-03-01', 4)), [null, null, 0, 0])
  })

  it('a rising curve is extended flat', () => {
    expectValues(closedExtension(burndown('2026-03-01', [10, 12, 15]), days('2026-03-01', 5)), [null, null, 15, 15, 15])
  })

  it('last point already on the last axis position → only that value', () => {
    expectValues(closedExtension(burndown('2026-03-01', [10, 5]), days('2026-03-01', 2)), [null, 5])
  })

  it('empty series → []', () => {
    expect(closedExtension([], days('2026-03-01', 3))).toEqual([])
  })
})

describe('§8.1 strategy selection', () => {
  const axis = days('2026-03-01', 11)
  const live = burndown('2026-03-01', [100, 90, 80, 70, 60, 50])

  it('closed → straight-line extension, never history', () => {
    const series = burndown('2026-03-01', [20, 18, 16, 14, 12])
    const r = selectForecast({ state: 'closed', series, axis, history: [linear()], today: '2026-03-03' })
    expect(r.strategy).toBe('closed-extension')
    expectValues(r.values, [null, null, null, null, 12, 10, 8, 6, 4, 2, 0])
  })

  it('live, today on the axis, usable history → shape', () => {
    const r = selectForecast({ state: 'current', series: live, axis, history: [linear(), linear()], today: '2026-03-06' })
    expect(r.strategy).toBe('shape')
    expectValues(r.values, [null, null, null, null, null, 50, 40, 30, 20, 10, 0], 6)
  })

  it('§15.5: shape declines (no history) → velocity answers instead', () => {
    const r = selectForecast({ state: 'current', series: live, axis, history: [], today: '2026-03-06' })
    expect(r.strategy).toBe('velocity')
    expect(r.values).toEqual(velocityForecast(live, [], 5, 10))
    expectValues(r.values, [null, null, null, null, null, 50, 40, 30, 20, 10, 0])
  })

  it('an unknown state is live', () => {
    const r = selectForecast({ state: 'weird', series: live, axis, history: [], today: '2026-03-06' })
    expect(r.strategy).toBe('velocity')
  })

  it('today remaining 0 → the shape strategy answers with zeros', () => {
    const series = burndown('2026-03-01', [100, 90, 0])
    const r = selectForecast({ state: 'current', series, axis, history: [], today: '2026-03-03' })
    expect(r.strategy).toBe('shape')
    expectValues(r.values, [null, null, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('today not on the axis → no forecast', () => {
    const r = selectForecast({ state: 'current', series: live, axis, history: [linear()], today: '2026-04-30' })
    expect(r).toEqual({ strategy: 'none', values: [] })
  })

  it('today on the last axis position → shape declines, velocity is empty', () => {
    const series = burndown('2026-03-01', [100, 90, 80])
    const r = selectForecast({ state: 'current', series, axis: days('2026-03-01', 3), history: [linear()], today: '2026-03-03' })
    expect(r).toEqual({ strategy: 'velocity', values: [] })
  })
})

describe('§8.5 deviation anchoring', () => {
  it('lastForecastValue = the LAST position that has a value (0 counts as a value)', () => {
    expect(lastForecastValue([null, 30, 20, null])).toBe(20)
    expect(lastForecastValue([5, 0])).toBe(0)
    expect(lastForecastValue([])).toBeNull()
    expect(lastForecastValue([null, null])).toBeNull()
  })

  it('deviationPercent = last / committedTotal × 100; 0 when committedTotal ≤ 0; null without values', () => {
    expect(deviationPercent([null, 30, 10], 100)).toBe(10)
    expect(deviationPercent([null, 30, 0.5], 100)).toBeCloseTo(0.5, 12)
    expect(deviationPercent([null, 30, 10], 0)).toBe(0)
    expect(deviationPercent([null, 30, 10], -1)).toBe(0)
    expect(deviationPercent([], 100)).toBeNull()
    expect(deviationPercent([null], 100)).toBeNull()
  })
})

describe('§6 forecast history selection', () => {
  const up = makeIteration({ state: 'upcoming', startDate: '2026-07-01' })
  const sel = makeIteration({ state: 'current', startDate: '2026-06-01' })
  const c1 = makeIteration({ state: 'closed', startDate: '2026-05-15' })
  const c2 = makeIteration({ state: 'closed', startDate: '2026-05-01' })
  const liveOld = makeIteration({ state: 'current', startDate: '2026-04-20' })
  const c3 = makeIteration({ state: 'closed', startDate: '2026-04-01' })
  const c4 = makeIteration({ state: 'closed', startDate: '2026-03-01' })
  const c5 = makeIteration({ state: 'closed', startDate: '2026-02-01' })
  const list = [up, sel, c1, c2, liveOld, c3, c4, c5]

  it('last 4 CLOSED iterations that start before the selected one, newest first', () => {
    expect(forecastHistory(list, sel)).toEqual([c1, c2, c3, c4])
  })

  it('the selected iteration is never in its own history; newer closed ones are excluded', () => {
    expect(forecastHistory(list, c2)).toEqual([c3, c4, c5])
  })

  it('"start before" is strict; null start dates never qualify', () => {
    const twin = makeIteration({ state: 'closed', startDate: '2026-05-01' })
    const undated = makeIteration({ state: 'closed', startDate: null })
    expect(forecastHistory([sel, c1, twin, c2, undated, c3], c2)).toEqual([c3])
    expect(forecastHistory(list, makeIteration({ state: 'current', startDate: null }))).toEqual([])
  })

  it('an iteration without a report still takes one of the 4 slots', () => {
    const a = makeIteration({ state: 'closed', startDate: '2026-05-20', report: null })
    expect(forecastHistory([sel, a, c1, c2, c3, c4], sel)).toEqual([a, c1, c2, c3])
  })

  it('custom max', () => {
    expect(forecastHistory(list, sel, 2)).toEqual([c1, c2])
  })

  it('historySeries maps to raw report series (no repair), [] when no report', () => {
    const s = [pt('2026-01-01', 10, 0)]
    const withReport = makeIteration({ state: 'closed', report: makeReport(s, 10, 0, 10) })
    const without = makeIteration({ state: 'closed', report: null })
    const out = historySeries([withReport, without])
    expect(out[0]).toBe(s)
    expect(out[1]).toEqual([])
  })
})
