import { describe, expect, it } from 'vitest'
import {
  axisMetrics,
  buildAxis,
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

describe('Amendment B burnup (GitLab / Jira burnup, burndown forecast mirrored)', () => {
  // Scope grows 40 → 44 on the 4th; due the 8th; today = the 4th.
  const series = [pt('2026-03-02', 40, 0), pt('2026-03-03', 40, 10), pt('2026-03-04', 44, 20)]
  const axis = buildAxis(series, '2026-03-08')
  // Burndown forecast (remaining) anchored on today = position 2.
  const finishing = [null, null, 24, 16, 8, 0, 0]
  const late = [null, null, 24, 20, 16, 12, 10]

  it('axis = the burndown axis: first point → due date (no 7-day cap)', () => {
    expect(burnup(series, axis, finishing, 2, '2026-03-08').axis).toEqual(days('2026-03-02', 7))
  })

  it('completed = delivered per date; total scope = committed per date, then the last scope carried forward', () => {
    const m = burnup(series, axis, finishing, 2, '2026-03-08')
    expectValues(m.completed, [0, 10, 20, null, null, null, null])
    expectValues(m.totalScope, [40, 40, 44, 44, 44, 44, 44])
    expect(m.scopeProjectedFrom).toBe(2)
  })

  it('ideal (guideline) rises from 0 to the first point\'s committed, exactly on the due date', () => {
    const m = burnup(series, axis, finishing, 2, '2026-03-08')
    expectValues(m.ideal, [0, 40 / 6, 80 / 6, 20, 160 / 6, 200 / 6, 40])
    expect(m.ideal[0]).toBe(0)
    expect(m.ideal[6]).toBe(40)
  })

  it('forecast starts ON today\'s Completed point (the join) and climbs by the work the burndown burns', () => {
    const m = burnup(series, axis, finishing, 2, '2026-03-08')
    expectValues(m.forecast, [null, null, 20, 28, 36, 44, 44])
    expect(m.forecast[2]).toBe(m.completed[2])
    for (let i = 3; i < m.forecast.length; i++) expect(m.forecast[i]!).toBeGreaterThanOrEqual(m.forecast[i - 1]!)
    expect(m.todayIndex).toBe(2)
  })

  it('projected completion = first position after the anchor where the forecast remaining reaches 0', () => {
    const m = burnup(series, axis, finishing, 2, '2026-03-08')
    expect(m.projectedDone).toEqual({ index: 5, date: '2026-03-07' })
    expect(m.openAtDue).toBeNull()
    expect(m.forecast[5]).toBe(m.totalScope[5]) // meets the Total line
  })

  it('never completing → work still open on the due date', () => {
    const m = burnup(series, axis, late, 2, '2026-03-08')
    expect(m.projectedDone).toBeNull()
    expect(m.openAtDue).toBe(10)
    expectValues(m.forecast, [null, null, 20, 24, 28, 32, 34])
  })

  it('already done at the anchor → neither a completion marker nor open work', () => {
    const done = [pt('2026-03-02', 10, 0), pt('2026-03-03', 10, 10)]
    const m = burnup(done, buildAxis(done, '2026-03-05'), [null, 0, 0, 0], 1, '2026-03-05')
    expect(m.projectedDone).toBeNull()
    expect(m.openAtDue).toBeNull()
    expectValues(m.forecast, [null, 10, 10, 10])
  })

  it('closed iteration (closed extension anchored on the last point): the forecast is that single point', () => {
    const closed = [pt('2026-03-02', 40, 0), pt('2026-03-03', 40, 20), pt('2026-03-04', 40, 34)]
    const m = burnup(closed, buildAxis(closed, '2026-03-04'), [null, null, 6], -1, '2026-03-04')
    expectValues(m.forecast, [null, null, 34])
    expect(m.openAtDue).toBe(6)
    expect(m.todayIndex).toBe(-1)
  })

  it('no forecast, or no Completed value at the anchor → forecast all null', () => {
    expectValues(burnup(series, axis, [], 2, '2026-03-08').forecast, Array(7).fill(null))
    expectValues(burnup(series, axis, [null, null, null, 5, 0], 3, '2026-03-08').forecast, Array(7).fill(null))
  })

  it('a zero span → ideal null everywhere', () => {
    const one = [pt('2026-03-02', 10, 4)]
    const m = burnup(one, buildAxis(one, '2026-03-02'), [], -1, '2026-03-02')
    expectValues(m.ideal, [null])
    expectValues(m.completed, [4])
    expectValues(m.totalScope, [10])
  })

  it('repaired point whose remaining (in-progress total) ≠ committed − delivered: the forecast still meets Total', () => {
    // today: committed 100, delivered 40, remaining 30 (in progress) — 30 pts are unaccounted for.
    const repaired = [pt('2026-03-02', 100, 0), pt('2026-03-03', 100, 40, 30)]
    const ax = buildAxis(repaired, '2026-03-06')
    const done = burnup(repaired, ax, [null, 30, 15, 0, 0], 1, '2026-03-06')
    expectValues(done.forecast, [null, 40, 70, 100, 100])
    expect(done.projectedDone).toEqual({ index: 3, date: '2026-03-05' })
    const late = burnup(repaired, ax, [null, 30, 24, 18, 15], 1, '2026-03-06')
    expectValues(late.forecast, [null, 40, 52, 64, 70])
    expect(late.openAtDue).toBe(30) // = Total − Forecast on the due date: the bracket's height
  })

  it('a negative remaining at the anchor (§7.1) → forecast flat at Completed, never below it', () => {
    const over = [pt('2026-03-02', 10, 0), pt('2026-03-03', 10, 15)]
    const m = burnup(over, buildAxis(over, '2026-03-05'), [null, -5, 0, 0], 1, '2026-03-05')
    expectValues(m.forecast, [null, 15, 15, 15])
    expect(m.projectedDone).toBeNull()
    expect(m.openAtDue).toBeNull()
  })

  it('nulls in the forecast after the anchor stay gaps', () => {
    const m = burnup(series, axis, [null, null, 24, null, 12, null, 6], 2, '2026-03-08')
    expectValues(m.forecast, [null, null, 20, null, 32, null, 38])
    expect(m.openAtDue).toBe(6)
  })

  it('open work is only reported ON the due date: none when the axis ends elsewhere or there is no due date', () => {
    // closed iteration with a point after its due date: the axis ends on 03-05, not on the due date 03-04
    const late = [pt('2026-03-02', 40, 0), pt('2026-03-03', 40, 20), pt('2026-03-05', 40, 34)]
    const ax = buildAxis(late, '2026-03-04')
    expect(ax[ax.length - 1]).toBe('2026-03-05')
    expect(burnup(late, ax, [null, null, null, 6], -1, '2026-03-04').openAtDue).toBeNull()
    expect(burnup(late, buildAxis(late, null), [null, null, 6], -1, null).openAtDue).toBeNull()
  })

  it('due date before the first point: the guideline still ends on the last axis position; scope has a gap there', () => {
    const early = [pt('2026-03-03', 20, 0), pt('2026-03-04', 20, 5)]
    const ax = buildAxis(early, '2026-03-02')
    expect(ax).toEqual(['2026-03-02', '2026-03-03', '2026-03-04'])
    const m = burnup(early, ax, [], -1, '2026-03-02')
    expectValues(m.totalScope, [null, 20, 20])
    expectValues(m.ideal, [null, 0, 20])
  })

  it('empty series → empty series everywhere', () => {
    const m = burnup([], [], [], -1, null)
    expect(m.axis).toEqual([])
    expect(m.completed).toEqual([])
    expect(m.totalScope).toEqual([])
    expect(m.ideal).toEqual([])
    expect(m.forecast).toEqual([])
    expect(m.scopeProjectedFrom).toBe(-1)
  })
})
