import { describe, expect, it } from 'vitest'
import { buildBurndownModel, buildBurnupModel } from './model'
import { burndown, days, expectValues, makeIteration, makeReport, pt } from './testkit'

// Past iterations burning 100 → 20 over 11 days: canonical shape y = 1 − 0.8 f (never reaches zero).
const pastSeries = () => burndown('2026-01-05', [100, 92, 84, 76, 68, 60, 52, 44, 36, 28, 20])

function liveScenario() {
  const selected = makeIteration({
    state: 'current',
    startDate: '2026-03-01',
    dueDate: '2026-03-11',
    report: makeReport(burndown('2026-03-01', [100, 90, 80, 70, 60]), 100, 50, 50),
  })
  const iterations = [
    makeIteration({ state: 'upcoming', startDate: '2026-03-15', report: makeReport(burndown('2026-03-15', [10, 10]), 10, 0, 10) }),
    selected,
    makeIteration({ state: 'closed', startDate: '2026-02-02', report: makeReport(pastSeries(), 100, 80, 20) }),
    makeIteration({ state: 'closed', startDate: '2026-01-05', report: makeReport(pastSeries(), 100, 80, 20) }),
  ]
  return { selected, iterations }
}

describe('burndown model wiring (§7–§9)', () => {
  it('live iteration: today point, trailing axis, shape forecast from history, both labels', () => {
    const { selected, iterations } = liveScenario()
    const m = buildBurndownModel({ iteration: selected, iterations, today: '2026-03-06' })
    expect(m.live).toBe(true)
    expect(m.series).toHaveLength(6)
    expect(m.series[5]).toEqual({ date: '2026-03-06', committed: 100, delivered: 50, remaining: 50 })
    expect(m.axis).toEqual(days('2026-03-01', 11))
    expect(m.todayIndex).toBe(5)
    expectValues(m.remaining, [100, 90, 80, 70, 60, 50, null, null, null, null, null])
    expectValues(m.ideal, [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0])
    expect(m.forecastStrategy).toBe('shape')
    // 50 × (1 − 0.08 i) / 0.6 for i ≥ 5
    expectValues(
      m.forecast,
      [null, null, null, null, null, 50, ...[6, 7, 8, 9, 10].map((i) => (50 * (1 - 0.08 * i)) / 0.6)],
      6,
    )
    expect(m.committedTotal).toBe(100)
    expect(m.tolerance as number).toBeCloseTo(10, 9)
    expect(m.labels).toHaveLength(2)
    expect(m.labels[0].text).toBe('Deviation +10 %')
    expect(m.labels[1].kind).toBe('forecast')
    expect(m.labels[1].text).toBe('Deviation +17 %') // 16.67 %
    expect(m.labels[1].value).toBeCloseTo(50 / 3, 6)
    expect(m.reserveGutter).toBe(true)
  })

  it('live iteration without usable history → velocity fallback', () => {
    const { selected } = liveScenario()
    const m = buildBurndownModel({ iteration: selected, iterations: [selected], today: '2026-03-06' })
    expect(m.forecastStrategy).toBe('velocity')
    // own direction over the last 5 points (90…50) = −10/day
    expectValues(m.forecast, [null, null, null, null, null, 50, 40, 30, 20, 10, 0])
    expect(m.labels.map((l) => l.kind)).toEqual(['tolerance'])
  })

  it('closed iteration: due-date repair, straight-line extension, green label only, no today dot', () => {
    const series = [pt('2026-03-06', 40, 0), pt('2026-03-23', 40, 28)]
    const closed = makeIteration({ state: 'closed', startDate: '2026-03-06', dueDate: '2026-03-24', report: makeReport(series, 40, 30, 7) })
    const m = buildBurndownModel({ iteration: closed, iterations: [closed], today: '2026-04-30' })
    expect(m.live).toBe(false)
    expect(m.todayIndex).toBe(-1)
    expect(m.axis).toEqual(['2026-03-06', '2026-03-23', '2026-03-24'])
    expectValues(m.remaining, [40, 12, 7])
    expect(m.forecastStrategy).toBe('closed-extension')
    expectValues(m.forecast, [null, null, 7])
    expect(m.labels.map((l) => l.kind)).toEqual(['tolerance'])
    expect(m.labels[0].value).toBeCloseTo(4, 9)
  })

  it('returns the report series itself when no repair applies', () => {
    const series = [pt('2026-03-06', 40, 0), pt('2026-03-24', 40, 30)]
    const closed = makeIteration({ state: 'closed', dueDate: '2026-03-24', report: makeReport(series, 40, 30, 10) })
    expect(buildBurndownModel({ iteration: closed, iterations: [closed], today: '2026-04-30' }).series).toBe(series)
  })

  it('no committed workload → no tolerance line, no labels, no gutter', () => {
    const noReport = makeIteration({ state: 'current', dueDate: '2026-03-11', report: null })
    const m = buildBurndownModel({ iteration: noReport, iterations: [noReport], today: '2026-03-06' })
    expect(m.committedTotal).toBe(0)
    expect(m.tolerance).toBeNull()
    expect(m.labels).toEqual([])
    expect(m.reserveGutter).toBe(false)
  })
})

describe('burnup model wiring (§7.6)', () => {
  it('uses the repaired series (today point included) and the 7-day extension', () => {
    const { selected } = liveScenario()
    const m = buildBurnupModel(selected, '2026-03-06')
    expect(m.axis).toEqual(days('2026-03-01', 11))
    expectValues(m.completed, [0, 10, 20, 30, 40, 50, null, null, null, null, null])
    expect(m.maxScope).toBe(100)
    expectValues(m.forecast, [null, null, null, null, null, null, 100, 100, 100, 100, 100])
  })
})
