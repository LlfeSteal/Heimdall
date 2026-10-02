import { describe, expect, it } from 'vitest'
import {
  axisMetrics,
  buildAxis,
  buildBurnupAxis,
  burnup,
  committedTotal,
  completeSeries,
  idealSeries,
  remainingSeries,
  TOLERANCE_RATIO,
  toleranceLevel,
  withDueDatePoint,
  withTodayPoint,
} from './curve'
import { days, expectValues, makeReport, pt } from './testkit'

// Report totals deliberately chosen so that inProgress (7) ≠ committed − delivered (10): the repaired
// point's `remaining` MUST be the in-progress total.
const totals = (series = [pt('2026-03-06', 40, 0)]) => makeReport(series, 40, 30, 7)

describe('§7.2 / §15.10 closed-iteration repair (withDueDatePoint)', () => {
  it('§15.10: points on the 6th and 23rd, due the 24th → gains a third point dated the 24th with the report totals', () => {
    const series = [pt('2026-03-06', 40, 0), pt('2026-03-23', 40, 28)]
    const out = withDueDatePoint(series, { state: 'closed', dueDate: '2026-03-24', report: totals(series) })
    expect(out).toHaveLength(3)
    expect(out[0]).toBe(series[0])
    expect(out[1]).toBe(series[1])
    expect(out[2]).toEqual({ date: '2026-03-24', committed: 40, delivered: 30, remaining: 7 })
    expect(series).toHaveLength(2) // additive only — input not mutated
  })

  it('§15.10: a closed iteration already reaching its due date is returned unchanged (same reference)', () => {
    const series = [pt('2026-03-06', 40, 0), pt('2026-03-24', 40, 28)]
    expect(withDueDatePoint(series, { state: 'closed', dueDate: '2026-03-24', report: totals(series) })).toBe(series)
  })

  it('last point after the due date → unchanged (same reference)', () => {
    const series = [pt('2026-03-06', 40, 0), pt('2026-03-25', 40, 28)]
    expect(withDueDatePoint(series, { state: 'closed', dueDate: '2026-03-24', report: totals(series) })).toBe(series)
  })

  it('no points / no due date / no report → unchanged (same reference)', () => {
    const empty: ReturnType<typeof pt>[] = []
    expect(withDueDatePoint(empty, { state: 'closed', dueDate: '2026-03-24', report: totals(empty) })).toBe(empty)
    const series = [pt('2026-03-06', 40, 0)]
    expect(withDueDatePoint(series, { state: 'closed', dueDate: null, report: totals(series) })).toBe(series)
    expect(withDueDatePoint(series, { state: 'closed', dueDate: '2026-03-24', report: null })).toBe(series)
  })

  it('does nothing for a live iteration (same reference)', () => {
    const series = [pt('2026-03-06', 40, 0)]
    expect(withDueDatePoint(series, { state: 'current', dueDate: '2026-03-24', report: totals(series) })).toBe(series)
  })
})

describe('§7.2 / §15.10 live-iteration repair (withTodayPoint)', () => {
  it('§15.10: a live iteration with no point for today gains one built from the current report totals', () => {
    const series = [pt('2026-03-09', 40, 10), pt('2026-03-10', 40, 20)]
    const out = withTodayPoint(series, { state: 'current', dueDate: '2026-03-20', report: totals(series) }, '2026-03-11')
    expect(out).toHaveLength(3)
    expect(out[2]).toEqual({ date: '2026-03-11', committed: 40, delivered: 30, remaining: 7 })
    expect(series).toHaveLength(2)
  })

  it('the today point is appended at the END, not sorted into place', () => {
    const series = [pt('2026-03-09', 40, 10), pt('2026-03-12', 40, 20)]
    const out = withTodayPoint(series, { state: 'current', dueDate: '2026-03-20', report: totals(series) }, '2026-03-11')
    expect(out.map((p) => p.date)).toEqual(['2026-03-09', '2026-03-12', '2026-03-11'])
  })

  it('an unknown state counts as live', () => {
    const series = [pt('2026-03-09', 40, 10)]
    const out = withTodayPoint(series, { state: 'mystery', dueDate: null, report: totals(series) }, '2026-03-11')
    expect(out.map((p) => p.date)).toEqual(['2026-03-09', '2026-03-11'])
  })

  it('an empty live series with a report gains the today point', () => {
    const out = withTodayPoint([], { state: 'current', dueDate: '2026-03-20', report: totals([]) }, '2026-03-11')
    expect(out).toEqual([{ date: '2026-03-11', committed: 40, delivered: 30, remaining: 7 }])
  })

  it('point for today already present → unchanged (same reference)', () => {
    const series = [pt('2026-03-10', 40, 10), pt('2026-03-11', 40, 20)]
    expect(withTodayPoint(series, { state: 'current', dueDate: null, report: totals(series) }, '2026-03-11')).toBe(series)
  })

  it('no report → unchanged; closed → unchanged (same reference)', () => {
    const series = [pt('2026-03-10', 40, 10)]
    expect(withTodayPoint(series, { state: 'current', dueDate: null, report: null }, '2026-03-11')).toBe(series)
    expect(withTodayPoint(series, { state: 'closed', dueDate: null, report: totals(series) }, '2026-03-11')).toBe(series)
  })
})

describe('§7.2 completeSeries', () => {
  it('closed → due-date repair', () => {
    const series = [pt('2026-03-06', 40, 0), pt('2026-03-23', 40, 28)]
    const out = completeSeries({ state: 'closed', dueDate: '2026-03-24', report: totals(series) }, '2026-04-30')
    expect(out.map((p) => p.date)).toEqual(['2026-03-06', '2026-03-23', '2026-03-24'])
  })

  it('live → today repair', () => {
    const series = [pt('2026-03-06', 40, 0)]
    const out = completeSeries({ state: 'current', dueDate: '2026-03-24', report: totals(series) }, '2026-03-08')
    expect(out.map((p) => p.date)).toEqual(['2026-03-06', '2026-03-08'])
  })

  it('returns the report series itself when nothing is added', () => {
    const series = [pt('2026-03-06', 40, 0), pt('2026-03-24', 40, 30)]
    const report = totals(series)
    expect(completeSeries({ state: 'closed', dueDate: '2026-03-24', report }, '2026-04-30')).toBe(series)
  })

  it('no report → empty series', () => {
    expect(completeSeries({ state: 'current', dueDate: '2026-03-24', report: null }, '2026-03-08')).toEqual([])
  })
})

describe('§7.3 axis', () => {
  it('fills only the trailing gap up to and including the due date; weekends are on the axis', () => {
    // 2026-03-07 is a Saturday, 2026-03-08 a Sunday. The interior hole 2026-03-04 is NOT filled.
    const series = [pt('2026-03-02', 10, 0), pt('2026-03-03', 10, 1), pt('2026-03-05', 10, 2)]
    expect(buildAxis(series, '2026-03-09')).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ])
  })

  it('leaves a hole at the start of the iteration alone (axis starts at the first point)', () => {
    const axis = buildAxis([pt('2026-03-04', 10, 0), pt('2026-03-05', 10, 1)], '2026-03-06')
    expect(axis).toEqual(['2026-03-04', '2026-03-05', '2026-03-06'])
  })

  it('sorts ascending and keeps each date once', () => {
    const series = [pt('2026-03-05', 10, 2), pt('2026-03-02', 10, 0), pt('2026-03-05', 10, 3), pt('2026-03-03', 10, 1)]
    expect(buildAxis(series, null)).toEqual(['2026-03-02', '2026-03-03', '2026-03-05'])
  })

  it('due date on the last point adds nothing; no due date adds nothing', () => {
    const series = [pt('2026-03-02', 10, 0), pt('2026-03-03', 10, 1)]
    expect(buildAxis(series, '2026-03-03')).toEqual(['2026-03-02', '2026-03-03'])
    expect(buildAxis(series, null)).toEqual(['2026-03-02', '2026-03-03'])
  })

  it('makes sure the due date is present even when it falls before the last point', () => {
    const series = [pt('2026-03-02', 10, 0), pt('2026-03-05', 10, 1), pt('2026-03-10', 10, 2)]
    expect(buildAxis(series, '2026-03-08')).toEqual(['2026-03-02', '2026-03-05', '2026-03-08', '2026-03-10'])
  })

  it('a live "today" point appended after the due date stays on the axis and is sorted', () => {
    const series = [pt('2026-03-08', 10, 0), pt('2026-03-09', 10, 1), pt('2026-03-12', 10, 5)]
    expect(buildAxis(series, '2026-03-10')).toEqual(['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-12'])
  })

  it('walks calendar days across a month end', () => {
    expect(buildAxis([pt('2026-02-27', 10, 0)], '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
  })
})

describe('§7.3 firstIndex / totalDays', () => {
  it('firstIndex = first axis position with a point; totalDays = max(last − firstIndex, 1)', () => {
    const axis = days('2026-03-01', 7)
    expect(axisMetrics(axis, [pt('2026-03-01', 10, 0)])).toEqual({ firstIndex: 0, totalDays: 6 })
    expect(axisMetrics(axis, [pt('2026-03-03', 10, 0), pt('2026-03-04', 10, 0)])).toEqual({ firstIndex: 2, totalDays: 4 })
  })

  it('totalDays is at least 1', () => {
    expect(axisMetrics(['2026-03-01'], [pt('2026-03-01', 10, 0)])).toEqual({ firstIndex: 0, totalDays: 1 })
  })

  it('no point on the axis → firstIndex −1', () => {
    expect(axisMetrics(['2026-03-01'], []).firstIndex).toBe(-1)
  })
})

describe('§7.4 remaining series', () => {
  it('value where there is a point, null where there is none (gap breaks the line, no interpolation)', () => {
    const series = [pt('2026-03-02', 10, 0), pt('2026-03-04', 10, 4)]
    const axis = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']
    expect(remainingSeries(series, axis)).toEqual([10, null, 6, null])
  })

  it('negative remaining is preserved, never clamped (§7.1, ledger #7)', () => {
    const series = [pt('2026-03-02', 10, 0), pt('2026-03-03', 10, 12)]
    expect(remainingSeries(series, ['2026-03-02', '2026-03-03'])).toEqual([10, -2])
  })

  it('uses the point\'s own remaining field', () => {
    const series = [pt('2026-03-02', 10, 0, 7)]
    expect(remainingSeries(series, ['2026-03-02'])).toEqual([7])
  })
})

describe('§7.4 ideal series', () => {
  it('descends linearly from the first real point to 0 on the last axis position', () => {
    const series = [pt('2026-03-01', 20, 0), pt('2026-03-02', 20, 9)]
    expectValues(idealSeries(series, days('2026-03-01', 5)), [20, 15, 10, 5, 0])
  })

  it('is null before firstIndex', () => {
    const series = [pt('2026-03-02', 8, 0)]
    expectValues(idealSeries(series, days('2026-03-01', 6)), [null, 8, 6, 4, 2, 0])
  })

  it('reaches EXACTLY 0 at the last position (30 over 11 days would be 3.5e-15 with naive float order)', () => {
    const ideal = idealSeries([pt('2026-03-01', 30, 0)], days('2026-03-01', 12))
    expect(ideal[11]).toBe(0)
    expect(ideal[1] as number).toBeCloseTo(30 - 30 / 11, 9)
  })

  it('depends only on the first point (later points do not bend it)', () => {
    const series = [pt('2026-03-01', 10, 0), pt('2026-03-02', 30, 0), pt('2026-03-03', 30, 29)]
    expectValues(idealSeries(series, days('2026-03-01', 3)), [10, 5, 0])
  })

  it('is never negative', () => {
    const ideal = idealSeries([pt('2026-03-01', 10, 0, -4)], days('2026-03-01', 3))
    for (const v of ideal) expect(v as number).toBeGreaterThanOrEqual(0)
  })
})

describe('§7.5 committedTotal and tolerance', () => {
  it('committedTotal = report committed workload when there is a report', () => {
    const series = [pt('2026-03-01', 55, 0)]
    expect(committedTotal(makeReport(series, 80, 0, 0), series)).toBe(80)
  })

  it('a report with committed 0 still wins over the first point', () => {
    const series = [pt('2026-03-01', 55, 0)]
    expect(committedTotal(makeReport(series, 0, 0, 0), series)).toBe(0)
  })

  it('falls back to the first point\'s committed workload, then 0', () => {
    expect(committedTotal(null, [pt('2026-03-01', 55, 0), pt('2026-03-02', 60, 0)])).toBe(55)
    expect(committedTotal(null, [])).toBe(0)
  })

  it('tolerance = committedTotal × 10 %', () => {
    expect(TOLERANCE_RATIO).toBe(0.1)
    expect(toleranceLevel(100) as number).toBeCloseTo(10, 9)
    expect(toleranceLevel(7) as number).toBeCloseTo(0.7, 9)
  })

  it('no committed workload → no tolerance line', () => {
    expect(toleranceLevel(0)).toBeNull()
    expect(toleranceLevel(-5)).toBeNull()
  })
})

describe('§7.6 burnup (KNOWN BEHAVIOUR formulas, ledger #8)', () => {
  // first committed = 2 ⇒ slope 2/day, visible before saturation
  const small = [pt('2026-03-02', 2, 0), pt('2026-03-03', 10, 1), pt('2026-03-04', 12, 3)]

  it('axis = series dates + up to 7 days after the last point (all on or before the due date)', () => {
    expect(buildBurnupAxis(small, '2026-03-13')).toEqual(days('2026-03-02', 10))
  })

  it('axis extension stops at the due date', () => {
    expect(buildBurnupAxis(small, '2026-03-07')).toEqual(days('2026-03-02', 6))
  })

  it('no extension when the due date is before the last point, or there is no due date', () => {
    expect(buildBurnupAxis(small, '2026-03-03')).toEqual(days('2026-03-02', 3))
    expect(buildBurnupAxis(small, null)).toEqual(days('2026-03-02', 3))
  })

  it('completed, total scope (constant maxScope) and the per-day forecast slope = first point committed', () => {
    const m = burnup(small, '2026-03-13')
    expect(m.axis).toEqual(days('2026-03-02', 10))
    expect(m.maxScope).toBe(12)
    expectValues(m.completed, [0, 1, 3, null, null, null, null, null, null, null])
    expect(m.totalScope).toEqual(Array(10).fill(12))
    // min(12, 3 + 2 × daysAfterLast): 5, 7, 9, 11, then capped at 12
    expectValues(m.forecast, [null, null, null, 5, 7, 9, 11, 12, 12, 12])
  })

  it('ideal DESCENDS from the first point\'s remaining (burndown formula reused on the burnup axis)', () => {
    const m = burnup(small, '2026-03-13')
    // firstRemaining = 2, totalDays = 9
    expectValues(m.ideal, Array.from({ length: 10 }, (_, i) => 2 - (2 / 9) * i))
    expect(m.ideal[9]).toBe(0)
  })

  it('realistic data: forecast saturates at maxScope on the very first projected day', () => {
    const series = [pt('2026-03-02', 40, 0), pt('2026-03-03', 40, 4), pt('2026-03-04', 44, 6)]
    const m = burnup(series, '2026-03-07')
    expect(m.maxScope).toBe(44)
    expectValues(m.forecast, [null, null, null, 44, 44, 44])
    expectValues(m.ideal, [40, 32, 24, 16, 8, 0])
  })

  it('no projected positions → forecast all null', () => {
    expectValues(burnup(small, null).forecast, [null, null, null])
  })

  it('a zero span → ideal is null everywhere (unlike the burndown ideal)', () => {
    const m = burnup([pt('2026-03-02', 10, 4)], '2026-03-02')
    expect(m.axis).toEqual(['2026-03-02'])
    expectValues(m.ideal, [null])
    expectValues(m.forecast, [null])
    expectValues(m.completed, [4])
  })

  it('empty series → empty model', () => {
    const m = burnup([], '2026-03-13')
    expect(m.axis).toEqual([])
    expect(m.maxScope).toBe(0)
    expect(m.completed).toEqual([])
    expect(m.totalScope).toEqual([])
    expect(m.ideal).toEqual([])
    expect(m.forecast).toEqual([])
  })
})
