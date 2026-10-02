// Screen 2 — iteration review: header, iteration chooser, centre states, strips, score panel, refresh scope
// (SPEC §3.2, §5.2, §5.3, §11.3, §12, §13, §14.2, §14.3, ledger #6, #16, #19, #21).
// Contract: docs/conformance/screens.md
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBurndownModel } from '../domain/model'
import { S } from '../strings'
import { datasetLabels, lastLineProps } from '../test/chartMock'
import { deferred, errorReply, type Reply } from '../test/fakeApi'
import {
  ALPHA,
  ALPHA_SCORE,
  BETA,
  CONFIG,
  DELTA,
  REPORT_ERROR,
  TEAM1,
  TODAY,
  X,
  estate,
  reportOf,
} from '../test/fixtures'
import {
  findRow,
  openCard,
  openTile,
  renderApp,
  resetTestEnvironment,
  selectIteration,
  waitForChart,
} from '../test/renderApp'

vi.mock('react-chartjs-2', () => import('../test/chartMock'))

afterEach(resetTestEnvironment)

const TERM = CONFIG.groupTerm
const range = (group: string, iid: string) => {
  const it = reportOf(group, iid)
  return S.dateRange(it.startDate, it.dueDate)
}
const header = () => screen.getByTestId('review-header')
const rail = () => screen.getByTestId('iteration-rail')
const scorePanels = () => screen.queryAllByTestId('score-panel')

describe('§3.2 header and iteration chooser', () => {
  it('SR01 header: product title, group name, full path, `Refresh`; rail: back control and `Iterations`', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    expect(within(header()).getByRole('heading', { name: S.productTitle })).toBeInTheDocument()
    expect(within(header()).getByText('Alpha')).toBeInTheDocument()
    expect(within(header()).getByText(ALPHA)).toBeInTheDocument()
    expect(within(header()).getByRole('button', { name: S.refresh })).toBeInTheDocument()
    expect(within(rail()).getByRole('button', { name: S.backToGroups(TERM) })).toBeInTheDocument()
    expect(within(rail()).getByRole('heading', { name: S.iterationsHeading })).toBeInTheDocument()
  })

  it('SR02 iterations loading: three placeholder rows', async () => {
    const hold = deferred<Reply>()
    const { user } = renderApp({ override: (c) => (c.path === '/api/iterations' ? hold.promise : undefined) })
    await openCard(user, 'Alpha')
    expect(await within(rail()).findAllByTestId('iteration-placeholder')).toHaveLength(3)
    expect(within(rail()).queryAllByTestId('iteration-row')).toHaveLength(0)
    hold.resolve({ body: estate.iterations[ALPHA] })
    expect(await within(rail()).findAllByTestId('iteration-row')).toHaveLength(6)
    expect(within(rail()).queryAllByTestId('iteration-placeholder')).toHaveLength(0)
  })

  it('SR03 iterations failure: the verbatim error text in the rail; the centre keeps its placeholder', async () => {
    const message = 'Group org/delivery/alpha: insufficient permissions'
    const { user } = renderApp({ override: (c) => (c.path === '/api/iterations' ? errorReply(message) : undefined) })
    await openCard(user, 'Alpha')
    expect(await within(rail()).findByText(message)).toBeInTheDocument()
    expect(screen.getByText(S.selectIteration)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-card')).toBeNull()
  })

  it('SR04 no iterations: `No iteration found for this ART.` and the centre placeholder', async () => {
    const { user } = renderApp()
    await openCard(user, 'Delta')
    expect(await within(rail()).findByText(S.noIterations(TERM))).toBeInTheDocument()
    expect(screen.getByText(S.selectIteration)).toBeInTheDocument()
    expect(within(rail()).queryAllByTestId('iteration-row')).toHaveLength(0)
  })

  it('SR05 rows newest-first, upcoming NEVER listed; each row = title, `start → due`, state badge', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const rows = await within(rail()).findAllByTestId('iteration-row')
    const listed = estate.reports[ALPHA].filter((it) => it.state !== 'upcoming')
    expect(rows).toHaveLength(listed.length)
    listed.forEach((it, i) => {
      expect(within(rows[i]).getByText(it.title)).toBeInTheDocument()
      expect(within(rows[i]).getByText(S.dateRange(it.startDate, it.dueDate))).toBeInTheDocument()
      expect(within(rows[i]).getByTestId('state-badge')).toHaveTextContent(it.state)
    })
    expect(within(rail()).queryByText('Sprint 8')).toBeNull()
  })
})

describe('§5.3 auto-selection', () => {
  it('SR06 opening a group selects the most recent non-upcoming iteration; its row is highlighted and its header shown', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    expect(await findRow('Sprint 7')).toHaveAttribute('aria-current', 'true')
    expect(within(rail()).getAllByTestId('iteration-row').filter((r) => r.getAttribute('aria-current') === 'true')).toHaveLength(1)
    expect(within(card).getByText('Sprint 7')).toBeInTheDocument()
    expect(within(card).getByText(range(ALPHA, '7'))).toBeInTheDocument()
    expect(within(card).getByTestId('state-badge')).toHaveTextContent('current')
  })

  it('SR07 ledger #6: auto-selection scans the UNFILTERED list (first entry upcoming, no current) → first non-upcoming', async () => {
    const { user } = renderApp()
    await openTile(user, 'Team One') // unfiltered: [4 upcoming, 3 closed, 2 closed, 1 closed]
    const card = await waitForChart()
    expect(within(card).getByText('T1 Sprint 3')).toBeInTheDocument()
    expect(await findRow('T1 Sprint 3')).toHaveAttribute('aria-current', 'true')
    expect(within(rail()).queryByText('T1 Sprint 4')).toBeNull()
  })

  it('SR08 every iteration upcoming: nothing listed, nothing selected, centre placeholder, no report read', async () => {
    const { api, user } = renderApp()
    await openTile(user, 'Xray')
    expect(await within(rail()).findByText(S.noIterations(TERM))).toBeInTheDocument()
    expect(screen.getByText(S.selectIteration)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-card')).toBeNull()
    expect(api.count('/api/reports', { group: X })).toBe(0)
  })
})

describe('§3.2 / §14.3 centre column states', () => {
  it('SR09 loading: `Loading data…`, no chart frame', async () => {
    const hold = deferred<Reply>()
    const { user } = renderApp({ override: (c) => (c.path === '/api/reports' ? hold.promise : undefined) })
    await openCard(user, 'Alpha')
    const card = await screen.findByTestId('chart-card')
    expect(await within(card).findByText(S.loadingData)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-line')).toBeNull()
    hold.resolve({ body: estate.reports[ALPHA] })
    await waitForChart()
    expect(screen.queryByText(S.loadingData)).toBeNull()
  })

  it('SR10 report read fails: verbatim message in the centre, no chart; score shows `Error: {message}`; annotation rail intact', async () => {
    const message = 'GraphQL error: Iteration report is not available'
    const { user } = renderApp({ override: (c) => (c.path === '/api/reports' ? errorReply(message) : undefined) })
    await openCard(user, 'Alpha')
    const card = await screen.findByTestId('chart-card')
    expect(await within(card).findByText(message)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-line')).toBeNull()
    await waitFor(() => expect(within(card).getByTestId('score-panel')).toHaveTextContent(S.scoreError(message)))
    const annotations = screen.getByTestId('annotations-rail')
    expect(within(annotations).getByRole('heading', { name: S.annotationsHeading(0) })).toBeInTheDocument()
    expect(within(annotations).getByText(S.helpHeading)).toBeInTheDocument()
  })

  it('SR11 an iteration carrying `reportError` shows that message verbatim as the chart error', async () => {
    const { user } = renderApp()
    await openCard(user, 'Beta')
    await waitForChart()
    await selectIteration(user, 'Cycle 5')
    const card = screen.getByTestId('chart-card')
    expect(await within(card).findByText(REPORT_ERROR)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-line')).toBeNull()
    expect(within(card).queryByText(S.noBurnupData)).toBeNull()
  })

  it('SR12 no report / empty series: `No burnup data found…`, never an empty chart frame', async () => {
    const { user } = renderApp()
    await openCard(user, 'Beta')
    await waitForChart()
    await selectIteration(user, 'Cycle 3') // report null, no reportError
    expect(await within(screen.getByTestId('chart-card')).findByText(S.noBurnupData)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-line')).toBeNull()
    await selectIteration(user, 'Cycle 4') // report with an empty series
    expect(await within(screen.getByTestId('chart-card')).findByText(S.noBurnupData)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-line')).toBeNull()
  })

  it('SR13 choosing another iteration: highlight moves, its chart replaces the previous one at once, no re-read (§5.2)', async () => {
    const { api, user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6')
    expect(await findRow('Sprint 6')).toHaveAttribute('aria-current', 'true')
    expect(await findRow('Sprint 7')).not.toHaveAttribute('aria-current', 'true')
    const card = await waitForChart()
    expect(within(card).getByText('Sprint 6')).toBeInTheDocument()
    const model = buildBurndownModel({ iteration: reportOf(ALPHA, '6'), iterations: estate.reports[ALPHA], today: TODAY })
    expect(lastLineProps().data.labels).toEqual(model.axis)
    expect(api.count('/api/reports', { group: ALPHA })).toBe(1)
    expect(api.count('/api/iterations', { group: ALPHA })).toBe(1)
  })

  it('SR14 view switch `Burndown` / `Burnup`: chart titles and legend entries', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    expect(within(card).getByRole('button', { name: S.viewBurndown })).toBeInTheDocument()
    expect(lastLineProps().options.plugins.title.text).toBe(S.burndownTitle)
    expect(datasetLabels()).toEqual([S.legendRemaining, S.legendIdeal, S.legendForecast])
    await user.click(within(card).getByRole('button', { name: S.viewBurnup }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burnupTitle))
    expect(datasetLabels()).toEqual([S.legendCompleted, S.legendTotalScope, S.legendIdeal, S.legendForecast])
    await user.click(within(card).getByRole('button', { name: S.viewBurndown }))
    await waitFor(() => expect(lastLineProps().options.plugins.title.text).toBe(S.burndownTitle))
  })
})

describe('§3.2 delivery summary strip and §12 metrics strip', () => {
  it('SR15 summary: green `Completed` share + `{delivered} of {committed}`, blue `In Progress` share + pair (one decimal)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6') // committed 50, delivered 45, in progress 5
    const summary = within(await waitForChart()).getByTestId('delivery-summary')
    const text = (summary.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toMatch(/Completed.*90%.*45\.0 of 50\.0.*In Progress.*10%.*5\.0 of 50\.0/)
  })

  it('SR16 metrics strip describes the DISPLAYED iteration: `Deviation: x.x%` and `Diff: ±x.x pts`, coloured (A.6)', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    let card = await waitForChart() // Sprint 7: committed 50, delivered 20
    let strip = within(card).getByTestId('metrics-strip')
    expect(within(strip).getByText('Deviation: 60.0%')).toHaveAttribute('data-tone', 'poor')
    expect(within(strip).getByText('Diff: +30.0 pts')).toHaveAttribute('data-tone', 'poor')
    await selectIteration(user, 'Sprint 6') // committed 50, delivered 45
    card = await waitForChart()
    strip = within(card).getByTestId('metrics-strip')
    expect(await within(strip).findByText('Deviation: 10.0%')).toHaveAttribute('data-tone', 'good')
    expect(within(strip).getByText('Diff: +5.0 pts')).toHaveAttribute('data-tone', 'caution')
    await selectIteration(user, 'Sprint 3') // committed 20, delivered 21 → over-delivered
    strip = within(await waitForChart()).getByTestId('metrics-strip')
    expect(await within(strip).findByText('Deviation: 5.0%')).toHaveAttribute('data-tone', 'good')
    expect(within(strip).getByText('Diff: -1.0 pts')).toHaveAttribute('data-tone', 'good')
  })
})

describe('§11.3 predictability score (compact panel)', () => {
  it('SR17 compact panel inside the chart card: heading + the four §15.3 figures with A.6 colours; expanded layout unreachable', async () => {
    const { user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    const panel = within(card).getByTestId('score-panel')
    expect(await within(panel).findByText(S.scoreCompactHeading)).toBeInTheDocument()
    expect(within(panel).getByText(S.scoreAvgDeviation)).toBeInTheDocument()
    expect(within(panel).getByText(S.scoreDeliveryDiff)).toBeInTheDocument()
    expect(within(panel).getByText(S.scoreCompliant)).toBeInTheDocument()
    expect(within(panel).getByText(S.scoreMedianVelocity)).toBeInTheDocument()
    expect(within(panel).getByText(ALPHA_SCORE.averageDeviation.text)).toHaveAttribute('data-tone', 'good')
    expect(within(panel).getByText(ALPHA_SCORE.deliveryDiff.text)).toHaveAttribute('data-tone', 'caution')
    expect(within(panel).getByText(ALPHA_SCORE.compliant.text)).toHaveAttribute('data-tone', 'caution')
    expect(within(panel).getByText(ALPHA_SCORE.medianVelocity.text)).not.toHaveAttribute('data-tone')
    // ledger #19: the expanded layout is never shown.
    expect(screen.queryByText(S.scoreExpandedHeading)).toBeNull()
    expect(screen.queryByText(/sprints? analyzed/)).toBeNull()
    expect(screen.queryByText(S.scoreUnderDelivered)).toBeNull()
  })

  it('SR18 placement: in the header while no iteration is chosen, inside the chart card once one is — never both', async () => {
    const { user } = renderApp()
    await openTile(user, 'Xray') // nothing selectable
    await within(rail()).findByText(S.noIterations(TERM))
    await waitFor(() => expect(scorePanels()).toHaveLength(1))
    expect(within(header()).getByTestId('score-panel')).toBeInTheDocument()

    await user.click(within(rail()).getByRole('button', { name: S.backToGroups(TERM) }))
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await waitFor(() => expect(within(card).getByTestId('score-panel')).toBeInTheDocument())
    expect(scorePanels()).toHaveLength(1)
    expect(within(header()).queryByTestId('score-panel')).toBeNull()
  })

  it('SR19 no closed iteration ⇒ `No score available` and NO report read at all (§11.2, §15.3)', async () => {
    const { api, user } = renderApp()
    await openTile(user, 'Xray')
    await waitFor(() => expect(within(header()).getByTestId('score-panel')).toHaveTextContent(S.scoreNone))
    expect(api.count('/api/reports')).toBe(0)
    await user.click(within(rail()).getByRole('button', { name: S.backToGroups(TERM) }))
    await openCard(user, 'Delta')
    await waitFor(() => expect(within(header()).getByTestId('score-panel')).toHaveTextContent(S.scoreNone))
    expect(api.count('/api/reports')).toBe(0)
  })

  it('SR20 loading text, then after 30 s `Timeout exceeded (30s)`; the late result is discarded; Refresh tries again', async () => {
    const hold = deferred<Reply>()
    const { api } = renderApp({
      fakeTimers: true,
      override: (c) => (c.path === '/api/reports' && !c.refresh ? hold.promise : undefined),
    })
    fireEvent.click(await screen.findByText('Alpha'))
    const card = await screen.findByTestId('chart-card')
    const panel = () => within(screen.getByTestId('chart-card')).getByTestId('score-panel')
    await waitFor(() => expect(panel()).toHaveTextContent(S.scoreLoading))
    expect(within(card).getByText(S.loadingData)).toBeInTheDocument() // the chart region loads on its own

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000)
    })
    expect(panel()).toHaveTextContent(S.scoreLoading)
    expect(panel()).not.toHaveTextContent(S.scoreTimeout)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(panel()).toHaveTextContent(S.scoreTimeout)

    // The read finally answers: the chart (an independent region) renders it, the score discards it.
    hold.resolve({ body: estate.reports[ALPHA] })
    await screen.findByTestId('chart-line')
    expect(panel()).toHaveTextContent(S.scoreTimeout)
    expect(within(panel()).queryByText(ALPHA_SCORE.averageDeviation.text)).toBeNull()

    // ledger #21: pressing Refresh starts a new request, which can succeed.
    fireEvent.click(within(header()).getByRole('button', { name: S.refresh }))
    await waitFor(() => expect(within(panel()).getByText(ALPHA_SCORE.averageDeviation.text)).toBeInTheDocument())
    expect(panel()).not.toHaveTextContent(S.scoreTimeout)
    expect(api.count('/api/reports', { group: ALPHA, refresh: true })).toBe(1)
  })
})

describe('§5.2 / §14.2 what is read, and what Refresh re-reads', () => {
  it('SR21 opening a group: ONE iterations read and ONE reports read serve chart, history and score', async () => {
    const { api, user } = renderApp()
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    await within(card).findByText(ALPHA_SCORE.averageDeviation.text)
    expect(api.count('/api/iterations', { group: ALPHA })).toBe(1)
    expect(api.count('/api/reports', { group: ALPHA })).toBe(1)
    expect(api.count('/api/reports', { refresh: true })).toBe(0)
  })

  it('SR22 review `Refresh` re-reads reports (curve + history + score) with refresh=1 — NEVER iterations or groups', async () => {
    const refreshed = structuredClone(estate.reports[ALPHA])
    const live = refreshed.find((r) => r.iid === '7')!
    live.report!.totals.delivered.weight = 25
    live.report!.totals.inProgress.weight = 25
    const { api, user } = renderApp({
      override: (c) => (c.path === '/api/reports' && c.refresh ? { body: refreshed } : undefined),
    })
    await openCard(user, 'Alpha')
    const card = await waitForChart()
    expect(within(card).getByText('Deviation: 60.0%')).toBeInTheDocument()
    const iterationsBefore = api.count('/api/iterations')
    const groupsBefore = api.count('/api/groups')
    await user.click(within(header()).getByRole('button', { name: S.refresh }))
    expect(await within(screen.getByTestId('chart-card')).findByText('Deviation: 50.0%')).toBeInTheDocument()
    expect(api.count('/api/reports', { group: ALPHA, refresh: true })).toBe(1)
    expect(api.count('/api/iterations')).toBe(iterationsBefore)
    expect(api.count('/api/groups')).toBe(groupsBefore)
    expect(await findRow('Sprint 7')).toHaveAttribute('aria-current', 'true') // selection kept
  })

  it('SR23 back control returns to the group list; re-entering the group re-reads its iterations (§14.2, ledger #16)', async () => {
    const { api, user } = renderApp()
    await openCard(user, 'Beta')
    await waitForChart()
    await user.click(within(rail()).getByRole('button', { name: S.backToGroups(TERM) }))
    expect(await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })).toBeInTheDocument()
    expect(screen.queryByTestId('review-header')).toBeNull()
    await openCard(user, 'Beta')
    await waitForChart()
    expect(api.count('/api/iterations', { group: BETA })).toBe(2)
    expect(api.count('/api/iterations', { group: DELTA })).toBe(0)
    expect(api.count('/api/iterations', { group: TEAM1 })).toBe(0)
  })
})
