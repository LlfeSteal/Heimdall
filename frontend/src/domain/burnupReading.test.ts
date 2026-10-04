import { describe, expect, it } from 'vitest'
import { S } from '../strings'
import { forecastCaption, progressLines } from './burnupReading'
import { buildAxis, burnup } from './curve'
import { pt } from './testkit'

const series = [pt('2026-03-02', 40, 0), pt('2026-03-03', 40, 10), pt('2026-03-04', 44, 20)]
const axis = buildAxis(series, '2026-03-08')

describe('Amendment B burnup reading', () => {
  it('caption: projected completion date and the days left before the due date', () => {
    const m = burnup(series, axis, [null, null, 24, 16, 8, 0, 0], 2, '2026-03-08')
    expect(forecastCaption(m, false)).toBe(S.burnupForecastDone('2026-03-07', 1))
    expect(S.burnupForecastDone('2026-03-07', 1)).toContain('1 day before')
    expect(S.burnupForecastDone('2026-03-06', 2)).toContain('2 days before')
    expect(S.burnupForecastDone('2026-03-08', 0)).toContain('on the due date')
  })

  it('caption: work still open on the due date (forecast wording when live, factual when closed)', () => {
    const m = burnup(series, axis, [null, null, 24, 20, 16, 12, 10], 2, '2026-03-08')
    expect(forecastCaption(m, false)).toBe(S.burnupForecastOpen('10.0 pts', '2026-03-08'))
    expect(forecastCaption(m, true)).toBe(S.burnupClosedOpen('10.0 pts', '2026-03-08'))
  })

  it('caption: nothing without a due date', () => {
    const m = burnup(series, axis, [null, null, 24, 16, 8, 0, 0], 2, null)
    expect(forecastCaption(m, false)).toBeNull()
  })

  it('caption: nothing without a forecast', () => {
    expect(forecastCaption(burnup(series, axis, [], 2, '2026-03-08'), false)).toBeNull()
    expect(forecastCaption(burnup([], [], [], -1, null), false)).toBeNull()
  })

  it('tooltip progress lines: Remaining = Total − Completed and the share done; nothing on projected days', () => {
    const m = burnup(series, axis, [], 2, '2026-03-08')
    expect(progressLines(m, 2)).toEqual([S.tooltipRemaining('24.0 pts'), S.tooltipComplete('45%')])
    expect(progressLines(m, 4)).toEqual([])
  })
})
