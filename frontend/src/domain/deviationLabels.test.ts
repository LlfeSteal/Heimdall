import { describe, expect, it } from 'vitest'
import { S } from '../strings'
import { deviationLabels, FORECAST_LABEL_MIN_PERCENT, placeDeviationLabels, reservesGutter } from './deviationLabels'

const forecastEndingAt = (end: number) => [null, 40, 25, end]

describe('§9 / §15.6 which deviation labels', () => {
  it('constants and literals', () => {
    expect(FORECAST_LABEL_MIN_PERCENT).toBe(1)
    expect(S.toleranceLabel).toBe('Deviation +10 %')
    expect(S.forecastLabel(10)).toBe('Deviation +10 %')
  })

  it('§15.6: committed 100, live, forecast ends at 10 → green +10 % at 10 AND orange +10 % at 10', () => {
    const labels = deviationLabels({ committedTotal: 100, state: 'current', forecast: forecastEndingAt(10) })
    expect(labels).toHaveLength(2)
    expect(labels[0].kind).toBe('tolerance')
    expect(labels[0].text).toBe('Deviation +10 %')
    expect(labels[0].value).toBeCloseTo(10, 9)
    expect(labels[1]).toEqual({ kind: 'forecast', text: 'Deviation +10 %', value: 10 })
  })

  it('§15.6: forecast ends at 0.5 → green only (below the 1 % floor)', () => {
    const labels = deviationLabels({ committedTotal: 100, state: 'current', forecast: forecastEndingAt(0.5) })
    expect(labels.map((l) => l.kind)).toEqual(['tolerance'])
  })

  it('a forecast at exactly 1 % in maths is not hidden by float noise (29 × 1 % = 0.29)', () => {
    const labels = deviationLabels({ committedTotal: 29, state: 'current', forecast: forecastEndingAt(0.29) })
    expect(labels[1]).toEqual({ kind: 'forecast', text: 'Deviation +1 %', value: 0.29 })
  })

  it('§15.6: forecast ends at 10 on a CLOSED iteration → green only', () => {
    const labels = deviationLabels({ committedTotal: 100, state: 'closed', forecast: forecastEndingAt(10) })
    expect(labels.map((l) => l.kind)).toEqual(['tolerance'])
  })

  it('§15.6: committed workload 0 → no labels at all', () => {
    expect(deviationLabels({ committedTotal: 0, state: 'current', forecast: forecastEndingAt(10) })).toEqual([])
    expect(deviationLabels({ committedTotal: -3, state: 'current', forecast: forecastEndingAt(10) })).toEqual([])
  })

  it('an unknown state counts as live (ledger #17)', () => {
    const labels = deviationLabels({ committedTotal: 100, state: 'something-else', forecast: forecastEndingAt(10) })
    expect(labels.map((l) => l.kind)).toEqual(['tolerance', 'forecast'])
  })

  it('a forecast with no value → green only', () => {
    expect(deviationLabels({ committedTotal: 100, state: 'current', forecast: [] }).map((l) => l.kind)).toEqual(['tolerance'])
    expect(deviationLabels({ committedTotal: 100, state: 'current', forecast: [null, null] }).map((l) => l.kind)).toEqual([
      'tolerance',
    ])
  })

  it('the 1 % floor is inclusive and compares the UNROUNDED percentage', () => {
    const at1 = deviationLabels({ committedTotal: 200, state: 'current', forecast: [null, 2] })
    expect(at1[1]).toEqual({ kind: 'forecast', text: 'Deviation +1 %', value: 2 })
    const below = deviationLabels({ committedTotal: 200, state: 'current', forecast: [null, 1.98] }) // 0.99 %
    expect(below.map((l) => l.kind)).toEqual(['tolerance'])
  })

  it('orange text is the whole-number rounded percentage; it sits at the forecast\'s last value', () => {
    const a = deviationLabels({ committedTotal: 50, state: 'current', forecast: [null, 30, 6.3, null] }) // 12.6 %
    expect(a[1]).toEqual({ kind: 'forecast', text: 'Deviation +13 %', value: 6.3 })
    const b = deviationLabels({ committedTotal: 50, state: 'current', forecast: [null, 6.2] }) // 12.4 %
    expect(b[1].text).toBe('Deviation +12 %')
  })

  it('the green label is always at the tolerance level (committedTotal × 10 %)', () => {
    const labels = deviationLabels({ committedTotal: 40, state: 'closed', forecast: [] })
    expect(labels).toHaveLength(1)
    expect(labels[0].value).toBeCloseTo(4, 9)
  })
})

describe('§9 gutter', () => {
  it('is reserved only when at least one label exists', () => {
    expect(reservesGutter([])).toBe(false)
    expect(reservesGutter(deviationLabels({ committedTotal: 100, state: 'closed', forecast: [] }))).toBe(true)
    expect(reservesGutter(deviationLabels({ committedTotal: 0, state: 'current', forecast: [5] }))).toBe(false)
  })
})

describe('§9 placement', () => {
  // value 0 → y 300, value 100 → y 100 (y grows downwards); plot spans y 20…300.
  const base = { toPixel: (v: number) => 300 - 2 * v, plotTop: 20, plotBottom: 300, labelHeight: 16 }

  it('each label sits at its value mapped to the plot; far-apart labels are untouched; input order kept', () => {
    expect(placeDeviationLabels({ ...base, values: [50, 60] })).toEqual([200, 180])
  })

  it('a label closer than one label-height below another is pushed down to exactly one label-height', () => {
    expect(placeDeviationLabels({ ...base, values: [50, 47] })).toEqual([200, 216])
    // input order is preserved even though the pushed label was listed first
    expect(placeDeviationLabels({ ...base, values: [47, 50] })).toEqual([216, 200])
  })

  it('equal values: the first in input order stays, the second is pushed one label-height down', () => {
    expect(placeDeviationLabels({ ...base, values: [50, 50] })).toEqual([200, 216])
  })

  it('pushes cascade using the already-pushed position', () => {
    expect(placeDeviationLabels({ ...base, values: [50, 50, 50] })).toEqual([200, 216, 232])
  })

  it('labels are pulled back inside the vertical bounds of the plot (centre within ±labelHeight/2)', () => {
    expect(placeDeviationLabels({ ...base, values: [140] })).toEqual([28]) // y 20 → 28
    expect(placeDeviationLabels({ ...base, values: [-10] })).toEqual([292]) // y 320 → 292
  })

  it('clamping happens after the push-down (literal order)', () => {
    // y 296 and 298 → push to 296, 312 → clamp both to 292
    expect(placeDeviationLabels({ ...base, values: [2, 1] })).toEqual([292, 292])
  })

  it('no labels → no positions', () => {
    expect(placeDeviationLabels({ ...base, values: [] })).toEqual([])
  })
})
