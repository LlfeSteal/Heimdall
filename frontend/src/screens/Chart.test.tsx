// The chart: datasets handed to Chart.js, tolerance line, gutter deviation labels, annotation callouts,
// burnup dots, tooltip footer, point clicks (SPEC §3.2, §3.6, §7.4–§7.6, §9, §10.5, §13, §15.6, ledger #13).
// Contract: docs/conformance/screens.md
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCOPE_DASH, readChartTheme } from '../components/chartSetup'
import { forecastCaption, progressLines } from '../domain/burnupReading'
import { buildBurndownModel, buildBurnupModel } from '../domain/model'
import { S } from '../strings'
import {
  annotationEntries,
  contentText,
  datasetByLabel,
  datasetLabels,
  indexOfDate,
  lastLineProps,
  tooltipFooterAt,
} from '../test/chartMock'
import { ALPHA, BETA, TODAY, estate, reportOf } from '../test/fixtures'
import { TOKEN_VALUES, installTokens } from '../test/tokens'
import {
  clickPoint,
  openCard,
  renderApp,
  resetTestEnvironment,
  selectIteration,
  tick,
  waitForChart,
} from '../test/renderApp'

vi.mock('react-chartjs-2', () => import('../test/chartMock'))

afterEach(resetTestEnvironment)

const burndown = (group: string, iid: string) =>
  buildBurndownModel({ iteration: reportOf(group, iid), iterations: estate.reports[group], today: TODAY })

const burnupOf = (group: string, iid: string) =>
  buildBurnupModel({ iteration: reportOf(group, iid), iterations: estate.reports[group], today: TODAY })

const isDashed = (d: Record<string, unknown>) => Array.isArray(d.borderDash) && d.borderDash.length > 0

/** The tolerance line: a horizontal line annotation at y = level. */
const toleranceLines = (level: number) =>
  annotationEntries().filter((e) => e.type === 'line' && e.yMin === level && e.yMax === level)

const gutterLabels = () =>
  screen.queryAllByTestId('deviation-label').map((el) => ({ kind: el.getAttribute('data-kind'), text: el.textContent }))

/** Adds an annotation through the UI on `date` of the currently displayed iteration. */
async function annotate(user: ReturnType<typeof renderApp>['user'], date: string, text: string, risk = false) {
  clickPoint(date)
  const dialog = await screen.findByTestId('annotation-dialog')
  if (risk) await user.click(within(dialog).getByRole('button', { name: S.typeRisk }))
  await user.type(within(dialog).getByPlaceholderText(S.textPlaceholder), text)
  await user.click(within(dialog).getByRole('button', { name: S.add }))
  await waitFor(() => expect(screen.queryByTestId('annotation-dialog')).toBeNull())
  tick()
}

describe('§7.4 burndown datasets', () => {
  it('SC01 x axis = model axis (ISO dates); Remaining / Ideal / Forecast data = the domain model, in legend order', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const model = burndown(ALPHA, '7')
    expect(lastLineProps().data.labels).toEqual(model.axis)
    expect(datasetLabels()).toEqual([S.legendRemaining, S.legendIdeal, S.legendForecast])
    expect(datasetByLabel(S.legendRemaining).data).toEqual(model.remaining)
    expect(datasetByLabel(S.legendIdeal).data).toEqual(model.ideal)
    expect(datasetByLabel(S.legendForecast).data).toEqual(model.forecast)
  })

  it('SC02 appearance: Remaining solid, filled, dots, gaps BREAK the line; Ideal dashed, no dots; Forecast dashed, no dots, bridges gaps', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const remaining = datasetByLabel(S.legendRemaining)
    expect(remaining.spanGaps).toBe(false)
    expect(remaining.fill).toBeTruthy()
    expect(remaining.pointRadius).not.toBe(0)
    expect(isDashed(remaining)).toBe(false)
    const ideal = datasetByLabel(S.legendIdeal)
    expect(isDashed(ideal)).toBe(true)
    expect(ideal.pointRadius).toBe(0)
    const forecast = datasetByLabel(S.legendForecast)
    expect(isDashed(forecast)).toBe(true)
    expect(forecast.pointRadius).toBe(0)
    expect(forecast.spanGaps).toBe(true)
  })

  // STYLEGUIDE.md wins over the §13 colour words (SPEC Implementation notes): today's dot is the `--today` red,
  // distinct from both the Remaining blue and the Forecast orange.
  it('SC03 live iteration: today’s dot is the today colour (red), every other dot the Remaining blue', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const model = burndown(ALPHA, '7')
    expect(model.todayIndex).toBe(indexOfDate(TODAY))
    const remaining = datasetByLabel(S.legendRemaining)
    const accent = readChartTheme().today
    expect(accent).not.toEqual(remaining.borderColor)
    expect(accent).not.toEqual(datasetByLabel(S.legendForecast).borderColor)
    const colours = remaining.pointBackgroundColor as unknown[]
    expect(colours).toHaveLength(model.axis.length)
    colours.forEach((c, i) => expect(c).toEqual(i === model.todayIndex ? accent : remaining.borderColor))
  })

  it('SC04 closed iteration: no today dot', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6')
    await waitFor(() => expect(lastLineProps().data.labels).toEqual(burndown(ALPHA, '6').axis))
    const remaining = datasetByLabel(S.legendRemaining)
    const colours = ([] as unknown[]).concat(remaining.pointBackgroundColor ?? remaining.borderColor)
    expect(colours).not.toContainEqual(readChartTheme().today)
    expect(colours).not.toContainEqual(datasetByLabel(S.legendForecast).borderColor)
  })
})

describe('§7.5 tolerance line and §9 / §15.6 deviation labels in the gutter', () => {
  it('SC05 live, forecast ≥ 1 %: dashed tolerance line at 10 % of committed; green `Deviation +10 %` and orange `Deviation +{n} %` in the gutter', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const model = burndown(ALPHA, '7')
    expect(model.labels.map((l) => l.kind)).toEqual(['tolerance', 'forecast']) // fixture sanity
    const lines = toleranceLines(model.tolerance!)
    expect(lines).toHaveLength(1)
    expect(isDashed(lines[0])).toBe(true)
    expect(screen.getByTestId('deviation-gutter')).toBeInTheDocument()
    expect(gutterLabels()).toEqual([
      { kind: 'tolerance', text: S.toleranceLabel },
      { kind: 'forecast', text: model.labels[1].text },
    ])
    expect(model.labels[1].text).toBe(S.forecastLabel(11))
  })

  it('SC06 the gutter labels are drawn OUTSIDE the plot (not as in-plot annotation labels)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    const inPlot = annotationEntries().map(contentText).join('\n')
    expect(inPlot).not.toContain('Deviation +')
  })

  it('SC07 closed iteration: green label only (§15.6)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6')
    await waitFor(() => expect(lastLineProps().data.labels).toEqual(burndown(ALPHA, '6').axis))
    expect(gutterLabels()).toEqual([{ kind: 'tolerance', text: S.toleranceLabel }])
  })

  it('SC08 live iteration whose forecast ends below 1 %: green label only (§15.6)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Beta')
    await waitForChart()
    expect(burndown(BETA, '7').labels).toHaveLength(1) // fixture sanity: forecast ends at 0
    expect(gutterLabels()).toEqual([{ kind: 'tolerance', text: S.toleranceLabel }])
    expect(toleranceLines(2)).toHaveLength(1)
  })

  it('SC09 committed workload 0: no tolerance line, no labels, no gutter reserved (§7.5, §9, §15.6)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Beta')
    await waitForChart()
    await selectIteration(user, 'Cycle 6')
    await waitFor(() => expect(lastLineProps().data.labels).toEqual(burndown(BETA, '6').axis))
    expect(gutterLabels()).toEqual([])
    expect(screen.queryByTestId('deviation-gutter')).toBeNull()
    expect(annotationEntries().filter((e) => e.type === 'line' && e.yMin === e.yMax && e.yMin !== undefined)).toEqual([])
  })
})

describe('Amendment B burnup view', () => {
  it('SC10 datasets = the burnup model: Completed (filled, gentle curve, dots), Total scope (solid, dashed when projected, shades the remaining work), Ideal, Forecast (dashed)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const model = burnupOf(ALPHA, '7')
    expect(lastLineProps().data.labels).toEqual(model.axis)
    const completed = datasetByLabel(S.legendCompleted)
    expect(completed.data).toEqual(model.completed)
    expect(completed.fill).toBeTruthy()
    expect(completed.cubicInterpolationMode).toBe('monotone') // a gentle curve that never overshoots
    expect(completed.pointRadius).not.toBe(0)
    const scope = datasetByLabel(S.legendTotalScope)
    expect(scope.data).toEqual(model.totalScope)
    expect(isDashed(scope)).toBe(false)
    expect(scope.fill).toMatchObject({ target: 0 }) // the band down to Completed = the remaining work
    const segmentDash = (p0DataIndex: number) => scope.segment.borderDash({ p0DataIndex })
    expect(segmentDash(model.scopeProjectedFrom - 1)).toBeUndefined()
    expect(segmentDash(model.scopeProjectedFrom)).toEqual(SCOPE_DASH)
    expect(datasetByLabel(S.legendIdeal).data).toEqual(model.ideal)
    expect(isDashed(datasetByLabel(S.legendIdeal))).toBe(true)
    expect(datasetByLabel(S.legendForecast).data).toEqual(model.forecast)
    expect(isDashed(datasetByLabel(S.legendForecast))).toBe(true)
  })

  it('SC11 burnup: no tolerance line and no deviation gutter (those belong to the burndown)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    expect(toleranceLines(5)).toHaveLength(0)
    expect(screen.queryByTestId('deviation-gutter')).toBeNull()
  })

  it('SC12 burnup annotations are dots only: a point marker on the affected date, no text, no callout', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await annotate(user, '2026-03-05', 'Scope added by PO')
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const entries = annotationEntries()
    expect(entries.filter((e) => e.type === 'point' && e.xValue === '2026-03-05')).toHaveLength(1)
    expect(entries.filter((e) => e.type === 'label' && e.callout?.display)).toHaveLength(0)
    expect(JSON.stringify(entries)).not.toContain('Scope added by PO')
  })

  it('SC12b forecast joins today\'s Completed point; its completion marker or open-at-due bracket is drawn; caption above', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const model = burnupOf(ALPHA, '7')
    expect(model.forecast[model.todayIndex]).toBe(model.completed[model.todayIndex])
    // The fixture's live Sprint 7 does not finish in time: the open-at-due bracket (completion: domain tests).
    expect(model.projectedDone).toBeNull()
    expect(model.openAtDue).not.toBeNull()
    const entries = annotationEntries()
    const theme = readChartTheme()
    const due = model.axis[model.axis.length - 1]
    const reached = model.forecast[model.axis.length - 1]!
    const bracket = entries.find((e) => e.type === 'line' && e.xMin === due && e.xMax === due)
    expect(bracket).toMatchObject({ yMin: reached, yMax: reached + model.openAtDue!, borderColor: theme.forecast })
    expect(entries.some((e) => e.type === 'label' && e.content === S.burnupOpenLabel(`${model.openAtDue!.toFixed(1)} ${S.pts}`))).toBe(true)
    expect(entries.some((e) => e.type === 'label' && String(e.content).startsWith('Done'))).toBe(false)
    const caption = forecastCaption(model, false)!
    expect(within(card).getByTestId('burnup-forecast')).toHaveTextContent(caption)
    expect(lastLineProps()['aria-label']).toContain(caption)
  })

  it('SC12d closed iteration: factual caption (no "Forecast:" wording), no today dot', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await selectIteration(user, 'Sprint 6')
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const model = burnupOf(ALPHA, '6')
    expect(model.todayIndex).toBe(-1)
    const caption = forecastCaption(model, true)
    if (caption === null) expect(within(card).queryByTestId('burnup-forecast')).toBeNull()
    else {
      expect(caption).not.toContain('Forecast:')
      await waitFor(() => expect(within(card).getByTestId('burnup-forecast')).toHaveTextContent(caption))
    }
  })

  it('SC12c burnup tooltip: values in pts, then Remaining and % complete, then the annotation texts', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await annotate(user, '2026-03-05', 'Scope added by PO')
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const model = burnupOf(ALPHA, '7')
    const i = model.axis.indexOf('2026-03-05')
    const callbacks = lastLineProps().options.plugins.tooltip.callbacks
    const item = { dataIndex: i, dataset: { label: S.legendCompleted }, parsed: { y: model.completed[i] } }
    expect(callbacks.label(item)).toBe(`${S.legendCompleted}: ${model.completed[i]!.toFixed(1)} ${S.pts}`)
    const lines = callbacks.afterBody([item])
    expect(lines).toEqual(progressLines(model, i))
    expect(lines[0]).toBe(S.tooltipRemaining(`${(model.totalScope[i]! - model.completed[i]!).toFixed(1)} ${S.pts}`))
    expect(callbacks.footer([item])).toEqual(['Scope added by PO'])
  })
})

describe('§3.6 / §10.5 annotations drawn on the burndown', () => {
  it('SC13 a callout label per annotation, anchored to its point, drawn BEHIND the data lines', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await annotate(user, '2026-03-05', 'Scope added by PO')
    await annotate(user, '2026-03-09', 'Prod incident', true)
    const model = burndown(ALPHA, '7')
    const labels = annotationEntries().filter((e) => e.type === 'label')
    const info = labels.find((e) => contentText(e).includes('Scope added by PO'))
    const risk = labels.find((e) => contentText(e).includes('Prod incident'))
    expect(info).toBeDefined()
    expect(risk).toBeDefined()
    for (const [entry, date] of [[info, '2026-03-05'], [risk, '2026-03-09']] as const) {
      expect(entry.drawTime).toBe('beforeDatasetsDraw')
      expect(entry.callout?.display).toBe(true)
      expect(entry.xValue).toBe(date)
      expect(entry.yValue).toBe(model.remaining[model.axis.indexOf(date)])
    }
    // Information is blue, Risk is red: at least they differ.
    expect(info.borderColor ?? info.backgroundColor).not.toEqual(risk.borderColor ?? risk.backgroundColor)
  })

  it('SC14 tooltip footer lists every annotation text of that date, one per line (ledger #13); nothing elsewhere', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await annotate(user, '2026-03-05', 'Scope added by PO')
    await annotate(user, '2026-03-09', 'Other day')
    // A second annotation on the same date can only be created by editing storage; add it there.
    const stored = JSON.parse(localStorage.getItem('heimdall-annotations.v1')!)
    stored.push({ ...stored[0], id: 'second-on-0305', text: 'Prod incident', createdAt: new Date().toISOString() })
    localStorage.setItem('heimdall-annotations.v1', JSON.stringify(stored))
    // Re-read happens on pair change: leave and re-enter the iteration.
    await selectIteration(user, 'Sprint 6')
    await selectIteration(user, 'Sprint 7')
    await waitFor(() => expect(lastLineProps().data.labels).toEqual(burndown(ALPHA, '7').axis))
    expect(tooltipFooterAt(indexOfDate('2026-03-05'))).toBe('Scope added by PO\nProd incident')
    expect(tooltipFooterAt(indexOfDate('2026-03-09'))).toBe('Other day')
    expect(tooltipFooterAt(indexOfDate('2026-03-06'))).toBe('')
  })

  it('SC15 clicking a chart point opens the dialogue on that date', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    clickPoint('2026-03-06')
    const dialog = await within(card).findByTestId('annotation-dialog')
    expect(within(dialog).getByText(S.dialogDate('2026-03-06'))).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: S.addAnnotation })).toBeInTheDocument()
  })
})

describe('STYLEGUIDE.md colours on the canvas (no colour in code; dark mode)', () => {
  it('SC16 burnup markers take the type colour: red when the date carries a Risk, blue otherwise', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await annotate(user, '2026-03-05', 'Scope added by PO')
    await annotate(user, '2026-03-09', 'Prod incident', true)
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const theme = readChartTheme()
    const marker = (date: string) => annotationEntries().find((e) => e.type === 'point' && e.xValue === date)
    expect(marker('2026-03-05').backgroundColor).toBe(theme.info)
    expect(marker('2026-03-09').backgroundColor).toBe(theme.risk)
  })

  it('SC16b burnup Total scope: its projected part has its own dash, distinct from Ideal', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const scope = datasetByLabel(S.legendTotalScope)
    const ideal = datasetByLabel(S.legendIdeal)
    expect(isDashed(ideal)).toBe(true)
    expect(scope.segment.borderDash({ p0DataIndex: burnupOf(ALPHA, '7').scopeProjectedFrom })).not.toEqual(ideal.borderDash)
  })

  it('SC16c burnup today dot is red, the other Completed dots green', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    const theme = readChartTheme()
    const model = burnupOf(ALPHA, '7')
    expect(model.todayIndex).toBeGreaterThan(0)
    const colours = datasetByLabel(S.legendCompleted).pointBackgroundColor as string[]
    expect(colours[model.todayIndex]).toBe(theme.today)
    expect(colours[0]).toBe(theme.delivered)
  })

  it('SC17 choosing Dark re-themes the chart from the dark tokens (series, today dot, callouts)', async () => {
    const uninstall = installTokens()
    try {
      const { user } = renderApp()
      await openCard(user, 'Alpha')
      await waitForChart()
      await annotate(user, '2026-03-09', 'Prod incident', true)
      await user.click(screen.getByRole('radio', { name: S.appearanceLight }))
      await waitFor(() => expect(datasetByLabel(S.legendRemaining).borderColor).toBe(TOKEN_VALUES.light.remaining))
      await user.click(screen.getByRole('radio', { name: S.appearanceDark }))
      await waitFor(() => expect(datasetByLabel(S.legendRemaining).borderColor).toBe(TOKEN_VALUES.dark.remaining))
      const model = burndown(ALPHA, '7')
      expect((datasetByLabel(S.legendRemaining).pointBackgroundColor as string[])[model.todayIndex]).toBe(TOKEN_VALUES.dark.today)
      expect(datasetByLabel(S.legendForecast).borderColor).toBe(TOKEN_VALUES.dark.forecast)
      expect(datasetByLabel(S.legendIdeal).borderColor).toBe(TOKEN_VALUES.dark.ideal)
      const callout = annotationEntries().find((e) => e.type === 'label')
      expect(callout.borderColor).toBe(TOKEN_VALUES.dark.risk)
      expect(callout.backgroundColor).toBe(TOKEN_VALUES.dark.card)
    } finally {
      uninstall()
      delete document.documentElement.dataset.theme
    }
  })
})
