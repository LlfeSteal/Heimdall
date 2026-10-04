// Wave-3 fixes on the screens: callouts kept inside the plot (D1, ledger #11 as changed), no browser freshness
// window (S-35, ledger #18), score timeout covering the iterations read (S-44), point clicks only on recorded
// points (S-60), callout box size (S-58), dashed legend swatches (D2), dialogue focus / labels (a11y).
// Contract: docs/conformance/final-audit.md "Wave-3 fixes (builder)".
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { annotationLabelSize } from '../domain/annotationGeometry'
import { buildBurndownModel, buildBurnupModel } from '../domain/model'
import { calloutLines } from '../components/calloutLayout'
import { S } from '../strings'
import { annotationEntries, clickChartAt, datasetByLabel, indexOfDate, lastLineProps } from '../test/chartMock'
import { deferred, type Reply } from '../test/fakeApi'
import { ALPHA, ALPHA_SCORE, TODAY, estate, reportOf } from '../test/fixtures'
import { openCard, renderApp, resetTestEnvironment, selectIteration, waitForChart } from '../test/renderApp'

vi.mock('react-chartjs-2', () => import('../test/chartMock'))

afterEach(resetTestEnvironment)

const KEY = 'heimdall-annotations.v1'

function seed(iid: string, notes: { date: string; text: string; type?: 'information' | 'risk' }[]) {
  localStorage.setItem(
    KEY,
    JSON.stringify(
      notes.map((n, i) => ({
        id: `seed-${i}`,
        groupPath: ALPHA,
        iterationId: iid,
        date: n.date,
        author: S.currentUser,
        text: n.text,
        type: n.type ?? 'information',
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    ),
  )
}

/**
 * Lays the captured burndown options out on a fake 600 × 300 plot the way Chart.js would: runs the y axis'
 * afterDataLimits on the data range, then maps values linearly. Returns every label box in pixels.
 */
function layoutCallouts(dataRange: { min: number; max: number }) {
  const options = lastLineProps().options
  const axis = lastLineProps().data.labels as string[]
  const area = { left: 40, right: 640, top: 20, bottom: 320 }
  const scale = { ...dataRange, height: area.bottom - area.top }
  options.scales.y.afterDataLimits(scale)
  const y = { min: scale.min, max: scale.max, getPixelForValue: (v: number) => area.top + ((scale.max - v) / (scale.max - scale.min)) * (area.bottom - area.top) }
  const x = { getPixelForValue: (i: number) => area.left + (i / (axis.length - 1)) * (area.right - area.left) }
  const ctx = { chart: { width: 760, chartArea: area, scales: { x, y } } }
  const labels = annotationEntries().filter((e) => e.type === 'label')
  return {
    area,
    boxes: labels.map((e) => {
      const lines = e.content as string[]
      const height = lines.length * 13 + 10 + 1
      const width = Math.max(...lines.map((l: string) => l.length), 1) * 6 + 14 + 1
      const anchorY = y.getPixelForValue(e.yValue) + e.yAdjust(ctx)
      const top = e.position.y === 'end' ? anchorY - height : anchorY
      const left = x.getPixelForValue(axis.indexOf(e.xValue)) + e.xAdjust(ctx)
      return { top, bottom: top + height, left, right: left + width, text: lines.join('\n') }
    }),
  }
}

describe('D1 / ledger #11 (changed): callouts stay inside the plot', () => {
  it('SW01 crowded closed sprint: 15 notes on the first date and 3 on the last — every box inside the plot', async () => {
    const model = buildBurndownModel({ iteration: reportOf(ALPHA, '6'), iterations: estate.reports[ALPHA], today: TODAY })
    const first = model.axis[0]
    const last = model.axis[model.axis.length - 1]
    seed('6', [
      ...Array.from({ length: 15 }, (_, k) => ({ date: first, text: `Crowded note ${k}\nsecond line` })),
      ...Array.from({ length: 3 }, (_, k) => ({ date: last, text: `Low note ${k}`, type: 'risk' as const })),
    ])
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6')
    await waitFor(() => expect(annotationEntries().filter((e) => e.type === 'label')).toHaveLength(18))
    const { area, boxes } = layoutCallouts({ min: 0, max: 50 })
    for (const b of boxes) {
      expect(b.top, b.text).toBeGreaterThanOrEqual(area.top - 0.5)
      expect(b.bottom, b.text).toBeLessThanOrEqual(area.bottom + 0.5)
      expect(b.left, b.text).toBeGreaterThanOrEqual(area.left - 0.5)
      expect(b.right, b.text).toBeLessThanOrEqual(area.right + 0.5)
    }
    // Still anchored to their points (the dashed callout runs back to the point).
    const labels = annotationEntries().filter((e) => e.type === 'label')
    expect(labels.filter((e) => e.xValue === first).every((e) => e.yValue === model.remaining[0])).toBe(true)
  })

  it('SW02 a lone note in the upper half grows upwards, one in the lower half downwards (§10.5)', async () => {
    const model = buildBurndownModel({ iteration: reportOf(ALPHA, '6'), iterations: estate.reports[ALPHA], today: TODAY })
    seed('6', [
      { date: model.axis[1], text: 'high' },
      { date: model.axis[model.axis.length - 1], text: 'low' },
    ])
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6')
    await waitFor(() => expect(annotationEntries().filter((e) => e.type === 'label')).toHaveLength(2))
    const [high, low] = annotationEntries().filter((e) => e.type === 'label')
    expect(high.position.y).toBe('end')
    expect(low.position.y).toBe('start')
    const { boxes, area } = layoutCallouts({ min: 0, max: 50 })
    for (const b of boxes) {
      expect(b.top).toBeGreaterThanOrEqual(area.top - 0.5)
      expect(b.bottom).toBeLessThanOrEqual(area.bottom + 0.5)
    }
  })
})

describe('S-58: callout box sized from the §10.5 estimate', () => {
  it('SW03 content = the capped lines; font / padding reproduce the estimated height', async () => {
    const text = `${'a very long annotation line '.repeat(5)}\nsecond\nthird\nfourth`
    seed('7', [{ date: '2026-03-05', text }])
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const [label] = annotationEntries().filter((e) => e.type === 'label')
    expect(label.content).toEqual(calloutLines(text))
    const lineHeight = label.font.size * label.font.lineHeight
    const height = label.content.length * lineHeight + label.padding.top + label.padding.bottom
    expect(height).toBeCloseTo(annotationLabelSize(text).height)
    expect(label.padding.left + label.padding.right).toBe(14)
  })
})

describe('S-60: only a recorded point opens the dialogue', () => {
  it('SW04 burndown: a click resolving to a date without a Remaining value (after today) opens nothing', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const model = buildBurndownModel({ iteration: reportOf(ALPHA, '7'), iterations: estate.reports[ALPHA], today: TODAY })
    const empty = model.axis.findIndex((_, i) => i > model.todayIndex && model.remaining[i] === null)
    expect(empty).toBeGreaterThan(0)
    act(() => clickChartAt(empty))
    expect(screen.queryByTestId('annotation-dialog')).toBeNull()
    act(() => clickChartAt(indexOfDate(TODAY)))
    expect(await screen.findByTestId('annotation-dialog')).toBeInTheDocument()
  })

  it('SW05 burnup: a click on the projected days (no Completed value) opens nothing', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const model = buildBurnupModel({ iteration: reportOf(ALPHA, '7'), iterations: estate.reports[ALPHA], today: TODAY })
    const empty = model.completed.findIndex((v) => v === null)
    expect(empty).toBeGreaterThan(0)
    act(() => clickChartAt(empty))
    expect(screen.queryByTestId('annotation-dialog')).toBeNull()
    act(() => clickChartAt(0))
    expect(await screen.findByTestId('annotation-dialog')).toBeInTheDocument()
  })
})

describe('S-44: the 30 s score timeout covers the iterations read too', () => {
  it('SW06 iterations held 30 s ⇒ `Timeout exceeded (30s)`; the late list does not bring the score back; Refresh retries', async () => {
    const hold = deferred<Reply>()
    renderApp({ fakeTimers: true, override: (c) => (c.path === '/api/iterations' ? hold.promise : undefined) })
    fireEvent.click(await screen.findByText('Alpha'))
    const panel = () => screen.getByTestId('score-panel')
    await waitFor(() => expect(panel()).toHaveTextContent(S.scoreLoading))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000)
    })
    expect(panel()).toHaveTextContent(S.scoreLoading)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(panel()).toHaveTextContent(S.scoreTimeout)
    hold.resolve({ body: estate.iterations[ALPHA] })
    await screen.findByTestId('chart-line')
    expect(panel()).toHaveTextContent(S.scoreTimeout)
    fireEvent.click(within(screen.getByTestId('review-header')).getByRole('button', { name: S.refresh }))
    await waitFor(() => expect(within(panel()).getByText(ALPHA_SCORE.averageDeviation.text)).toBeInTheDocument())
  })
})

describe('S-35 / ledger #18: no browser freshness window on top of the backend', () => {
  it('SW07 showing the group list again re-reads the groups (without refresh=1, even after a Refresh); re-entering a group re-reads its reports', async () => {
    const { api, user } = renderApp()
    await screen.findByRole('heading', { name: S.availableGroups('ART', 3) })
    await user.click(screen.getByRole('button', { name: S.refresh }))
    await waitFor(() => expect(api.count('/api/groups', { refresh: true })).toBe(1))
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6')
    await waitForChart()
    expect(api.count('/api/reports', { group: ALPHA })).toBe(1) // switching iteration: no re-read (§5.2)
    const groupsBefore = api.count('/api/groups')
    await user.click(screen.getByRole('button', { name: S.backToGroups('ART') }))
    await waitFor(() => expect(api.count('/api/groups')).toBe(groupsBefore + 1))
    expect(api.count('/api/groups', { refresh: true })).toBe(1)
    await openCard(user, 'Alpha')
    await waitForChart()
    expect(api.count('/api/reports', { group: ALPHA })).toBe(2)
    expect(api.count('/api/reports', { refresh: true })).toBe(0)
  })
})

describe('D2 and accessibility', () => {
  it('SW08 legend swatches use the series line style; dashed series are drawn as (dashed) lines', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const legend = lastLineProps().options.plugins.legend.labels
    expect(legend.usePointStyle).toBe(true)
    expect(typeof legend.generateLabels).toBe('function')
    expect(datasetByLabel(S.legendIdeal).pointStyle).toBe('line')
    expect(datasetByLabel(S.legendForecast).pointStyle).toBe('line')
    expect(lastLineProps()['aria-label']).toBe(S.burndownTitle)
  })

  it('SW09 the dialogue moves focus into its labelled text field; the view switch is a labelled group', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    expect(within(card).getByRole('group', { name: `${S.viewBurndown} / ${S.viewBurnup}` })).toBeInTheDocument()
    act(() => clickChartAt(indexOfDate('2026-03-05')))
    const field = await screen.findByRole('textbox', { name: S.textPlaceholder })
    expect(field).toHaveFocus()
  })
})
