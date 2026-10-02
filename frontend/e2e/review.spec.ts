// Screen 2 — iteration review: auto-selection, real canvas rendering, deviation gutter, burnup, refresh,
// per-region errors and the score panel (SPEC §3.2, §5.3, §7.4–§7.6, §9, §11.3, §12, §13, §14).
import {
  ALPHA,
  COLOURS,
  DELTA_ERROR,
  TEAM1,
  TEAM1_REPORT_ERROR,
  apiIterations,
  apiReports,
  canvasHasColourNear,
  canvasPixelStats,
  chartSnapshot,
  gotoGroupList,
  openCard,
  openTile,
  selectIteration,
  shot,
  todayUtc,
  expect,
  test,
} from './helpers'

test.describe('E-R iteration review', () => {
  test('E-R1 opening a group auto-selects the newest non-upcoming iteration; upcoming never listed', async ({ page, request }) => {
    const its = await apiIterations(request, ALPHA)
    const expected = its.find((it) => it.state !== 'upcoming')!
    const listable = its.filter((it) => it.state !== 'upcoming')
    expect(its.some((it) => it.state === 'upcoming')).toBe(true)

    await gotoGroupList(page)
    await openCard(page, 'alpha')
    const header = page.getByTestId('review-header')
    await expect(header.locator('h1')).toHaveText('Heimdall')
    await expect(header).toContainText('Alpha Release Train')
    await expect(header).toContainText(ALPHA)
    await expect(page.getByRole('button', { name: '← Back to ARTs' })).toBeVisible()
    await expect(page.getByTestId('iteration-rail').getByRole('heading', { name: 'Iterations' })).toBeVisible()

    const rows = page.getByTestId('iteration-row')
    await expect(rows).toHaveCount(listable.length)
    await expect(rows.locator('.iteration-title')).toHaveText(listable.map((it) => it.title))
    for (const up of its.filter((it) => it.state === 'upcoming')) {
      await expect(page.getByTestId('iteration-rail')).not.toContainText(up.title)
    }
    await expect(rows.first()).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[data-testid=iteration-row][aria-current=true]')).toHaveCount(1)
    await expect(rows.first()).toContainText(`${expected.startDate} → ${expected.dueDate}`)
    await expect(rows.first().getByTestId('state-badge')).toHaveText(expected.state)

    const card = page.getByTestId('chart-card')
    await expect(card.locator('.iteration-header h2')).toHaveText(expected.title)
    await expect(card.locator('.iteration-header')).toContainText(`${expected.startDate} → ${expected.dueDate}`)
    await expect(card.getByTestId('state-badge')).toHaveText(expected.state)
  })

  test('E-R2 burndown canvas renders non-blank with title, legend and today\'s accent point', async ({ page, request }) => {
    const reports = await apiReports(request, ALPHA)
    const live = reports.find((r) => r.state !== 'upcoming')!
    expect(live.state).toBe('current')
    const today = todayUtc()

    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await expect(page.locator('canvas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Burndown' })).toHaveAttribute('aria-pressed', 'true')

    const snap = await chartSnapshot(page)
    expect(snap.type).toBe('line')
    expect(snap.title).toBe('Burndown Chart')
    expect(snap.legend).toEqual(['Remaining', 'Ideal', 'Forecast'])
    expect(snap.datasets.map((d) => d.label)).toEqual(['Remaining', 'Ideal', 'Forecast'])
    expect(snap.dataUrlLength).toBeGreaterThan(20_000)

    const stats = await canvasPixelStats(page)
    expect(stats.colours).toBeGreaterThan(20)
    expect(stats.variance).toBeGreaterThan(50)

    // Axis runs to the due date; today's point exists (repair §7.2) and carries the accent (§7.4, §13).
    expect(snap.labels[0]).toBe(live.startDate)
    expect(snap.labels.at(-1)).toBe(live.dueDate)
    const ti = snap.labels.indexOf(today)
    expect(ti).toBeGreaterThan(0)
    expect(live.report!.series.some((p) => p.date === today)).toBe(false) // the mock stops yesterday
    expect(snap.datasets[0].data[ti]).toBe(live.report!.totals.inProgress.weight)
    const pbc = snap.datasets[0].pointBackgroundColor as string[]
    expect(pbc[ti]).toBe(COLOURS.ACCENT)
    expect(pbc.filter((c) => c === COLOURS.ACCENT)).toHaveLength(1)
    expect(snap.datasets[0].borderColor).toBe(COLOURS.BLUE)
    expect(snap.datasets[1].borderColor).toBe(COLOURS.GREY)
    expect(snap.datasets[2].borderColor).toBe(COLOURS.ACCENT)
    // ...and is actually painted on the canvas in the accent colour.
    expect(snap.points[ti].skip).toBe(false)
    expect(await canvasHasColourNear(page, snap.points[ti].x, snap.points[ti].y, COLOURS.ACCENT, 3)).toBe(true)
    // Remaining is blank after today (gap breaks the line), forecast starts at today.
    expect(snap.datasets[0].data.slice(ti + 1).every((v) => v === null)).toBe(true)
    // Tolerance line at 10 % of committed.
    const tol = snap.annotations.find((a) => a.type === 'line')
    expect(tol?.yMin).toBeCloseTo(live.report!.totals.committed.weight * 0.1, 5)

    // Legend + title visible on the canvas: the title text is drawn above the chart area.
    expect(snap.chartArea.top).toBeGreaterThan(20)
    await expect(page.getByTestId('metrics-strip')).toContainText('Deviation:')
    await expect(page.getByTestId('metrics-strip')).toContainText('Diff:')
    await expect(page.getByTestId('delivery-summary')).toContainText('Completed')
    await expect(page.getByTestId('delivery-summary')).toContainText('In Progress')
  })

  test('E-R3 deviation gutter labels sit right of the plot, inside its vertical bounds, without overlap', async ({ page, request }) => {
    const reports = await apiReports(request, ALPHA)
    const live = reports.find((r) => r.state !== 'upcoming')!
    const committed = live.report!.totals.committed.weight

    await gotoGroupList(page)
    await openCard(page, 'alpha')
    const labels = page.getByTestId('deviation-label')
    await expect(labels.filter({ hasText: 'Deviation +10 %' })).toBeVisible()
    await expect(page.getByTestId('deviation-gutter')).toHaveAttribute('data-placed', 'true')
    await expect(labels).toHaveCount(2)
    const kinds = await labels.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind))
    expect(kinds.sort()).toEqual(['forecast', 'tolerance'])

    const snap0 = await chartSnapshot(page)
    const forecastEnd = snap0.datasets[2].data.at(-1) as number
    const snap = await chartSnapshot(page, [committed * 0.1, forecastEnd])
    const plotRight = snap.canvasRect.x + snap.chartArea.right
    const plotTop = snap.canvasRect.y + snap.chartArea.top
    const plotBottom = snap.canvasRect.y + snap.chartArea.bottom
    const canvasRight = snap.canvasRect.x + snap.canvasRect.width

    const boxes = []
    for (const el of await labels.all()) {
      const box = (await el.boundingBox())!
      const kind = await el.getAttribute('data-kind')
      const text = (await el.textContent())!
      boxes.push({ kind, text, ...box })
      expect(box.x, `${text} left edge right of the plot`).toBeGreaterThanOrEqual(plotRight)
      expect(box.x + box.width, `${text} not clipped by the canvas edge`).toBeLessThanOrEqual(canvasRight + 0.5)
      expect(box.y, `${text} inside plot top`).toBeGreaterThanOrEqual(plotTop - 0.5)
      expect(box.y + box.height, `${text} inside plot bottom`).toBeLessThanOrEqual(plotBottom + 0.5)
    }
    const [a, b] = boxes
    const overlap = a.y < b.y + b.height && b.y < a.y + a.height
    expect(overlap, 'labels must not overlap').toBe(false)

    // Vertical position = the value it annotates (§9), unless pushed by the anti-overlap rule.
    const tolBox = boxes.find((x) => x.kind === 'tolerance')!
    const fcBox = boxes.find((x) => x.kind === 'forecast')!
    expect(fcBox.text).toBe(`Deviation +${Math.round((forecastEnd / committed) * 100)} %`)
    const tolY = snap.yPixels[String(committed * 0.1)]
    const fcY = snap.yPixels[String(forecastEnd)]
    if (Math.abs(tolY - fcY) >= 20) {
      expect(Math.abs(tolBox.y + tolBox.height / 2 - tolY)).toBeLessThan(2)
      expect(Math.abs(fcBox.y + fcBox.height / 2 - fcY)).toBeLessThan(2)
    }
    // Ordered top-to-bottom by value.
    expect(forecastEnd > committed * 0.1 ? fcBox.y < tolBox.y : fcBox.y > tolBox.y).toBe(true)
    // Colours per §13: green tolerance, warm forecast.
    expect(await page.locator('[data-kind=tolerance]').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(22, 163, 74)')
    const fcColour = await page.locator('[data-kind=forecast]').evaluate((e) => getComputedStyle(e).color)
    expect(fcColour).toMatch(/^rgb\((2[0-5]\d|19\d), \d+, \d+\)$/) // warm (red-dominant)
  })

  test('E-R4 closed iteration: green label only, no accent point', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await selectIteration(page, 'Sprint 6')
    await expect(page.getByTestId('deviation-label')).toHaveCount(1)
    await expect(page.getByTestId('deviation-label')).toHaveText('Deviation +10 %')
    await expect(page.getByTestId('deviation-gutter')).toHaveAttribute('data-placed', 'true')
    const snap = await chartSnapshot(page)
    const pbc = snap.datasets[0].pointBackgroundColor as string[]
    expect(pbc.every((c) => c === COLOURS.BLUE)).toBe(true)
    const box = (await page.getByTestId('deviation-label').boundingBox())!
    // Re-placed for the NEW iteration's tolerance level (the gutter plugin re-runs after the chart update).
    const tol = snap.annotations.find((a) => a.type === 'line')!.yMin as number
    const tolY = (await chartSnapshot(page, [tol])).yPixels[String(tol)]
    expect(Math.abs(box.y + box.height / 2 - tolY)).toBeLessThan(2)
    expect(box.x).toBeGreaterThanOrEqual(snap.canvasRect.x + snap.chartArea.right)
    expect(box.y).toBeGreaterThanOrEqual(snap.canvasRect.y + snap.chartArea.top - 0.5)
    expect(box.y + box.height).toBeLessThanOrEqual(snap.canvasRect.y + snap.chartArea.bottom + 0.5)
  })

  test('E-R5 burnup tab renders', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await page.getByRole('button', { name: 'Burnup' }).click()
    await expect(page.getByRole('button', { name: 'Burnup' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('deviation-gutter')).toHaveCount(0)
    await expect.poll(async () => (await chartSnapshot(page)).title).toBe('Burnup Chart')
    const snap = await chartSnapshot(page)
    expect(snap.legend).toEqual(['Completed', 'Total scope', 'Ideal', 'Forecast'])
    expect(snap.datasets[0].borderColor).toBe(COLOURS.GREEN)
    expect(snap.datasets[1].borderColor).toBe(COLOURS.NEUTRAL)
    expect(snap.datasets[3].borderColor).toBe(COLOURS.ACCENT)
    expect(snap.annotations.filter((a) => a.type === 'line')).toHaveLength(0)
    const stats = await canvasPixelStats(page)
    expect(stats.colours).toBeGreaterThan(20)
    expect(snap.dataUrlLength).toBeGreaterThan(20_000)
    await shot(page, '03-burnup')
    await page.getByRole('button', { name: 'Burndown' }).click()
    await expect.poll(async () => (await chartSnapshot(page)).title).toBe('Burndown Chart')
    await expect(page.getByTestId('deviation-gutter')).toHaveAttribute('data-placed', 'true')
    const back = await chartSnapshot(page)
    const tol = back.annotations.find((a) => a.type === 'line')!.yMin as number
    const tolY = (await chartSnapshot(page, [tol])).yPixels[String(tol)]
    const tb = (await page.locator('[data-testid=deviation-label][data-kind=tolerance]').boundingBox())!
    expect(Math.abs(tb.y + tb.height / 2 - tolY)).toBeLessThan(2)
  })

  test('E-R6 review Refresh re-reads /api/reports?…refresh=1 and never /api/iterations or /api/groups', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await expect(page.locator('canvas')).toBeVisible()
    await selectIteration(page, 'Sprint 5')
    const seen: string[] = []
    page.on('request', (r) => {
      const u = new URL(r.url())
      if (u.pathname.startsWith('/api/')) seen.push(u.pathname + u.search)
    })
    const res = page.waitForResponse((r) => r.url().includes('/api/reports') && r.url().includes('refresh=1'))
    await page.getByTestId('review-header').getByRole('button', { name: 'Refresh' }).click()
    await res
    await expect(page.locator('canvas')).toBeVisible()
    await page.waitForTimeout(500)
    expect(seen.filter((u) => u.startsWith('/api/reports'))).toEqual([
      `/api/reports?group=${encodeURIComponent(ALPHA)}&refresh=1`,
    ])
    expect(seen.filter((u) => u.startsWith('/api/iterations'))).toEqual([])
    expect(seen.filter((u) => u.startsWith('/api/groups'))).toEqual([])
    // Selection kept.
    await expect(page.getByTestId('chart-card').locator('.iteration-header h2')).toHaveText('Sprint 5')
  })

  test('E-R7 switching iteration does not re-read; re-entering re-reads iterations', async ({ page }) => {
    await gotoGroupList(page)
    const seen: string[] = []
    page.on('request', (r) => {
      const u = new URL(r.url())
      if (u.pathname.startsWith('/api/')) seen.push(u.pathname + u.search)
    })
    await openCard(page, 'alpha')
    await expect(page.locator('canvas')).toBeVisible()
    await selectIteration(page, 'Sprint 4')
    await selectIteration(page, 'Sprint 6')
    await expect(page.locator('canvas')).toBeVisible()
    expect(seen.filter((u) => u.startsWith('/api/reports'))).toHaveLength(1)
    expect(seen.filter((u) => u.startsWith('/api/iterations'))).toHaveLength(1)
    await page.getByRole('button', { name: '← Back to ARTs' }).click()
    await openCard(page, 'alpha')
    await expect(page.locator('canvas')).toBeVisible()
    expect(seen.filter((u) => u.startsWith('/api/iterations'))).toHaveLength(2)
    // Re-entry resets to the auto-selected iteration.
    await expect(page.getByTestId('chart-card').locator('.iteration-header h2')).toHaveText('Sprint 7')
  })

  test('E-R8 a group whose reads fail (delta) opens, shows the verbatim error in the rail, other regions render', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'delta')
    await expect(page.getByTestId('review-header')).toContainText('Delta Release Train')
    await expect(page.getByTestId('iteration-rail')).toContainText(DELTA_ERROR)
    await expect(page.getByTestId('iteration-row')).toHaveCount(0)
    await expect(page.getByText('Select an iteration to display the charts.')).toBeVisible()
    await expect(page.getByTestId('chart-card')).toHaveCount(0)
    const rail = page.getByTestId('annotations-rail')
    await expect(rail.getByRole('heading', { name: 'Annotations (0)' })).toBeVisible()
    await expect(rail).toContainText('How to use')
    await expect(rail).toContainText('- Click a point to annotate')
    await expect(rail).toContainText('- Annotations stored locally')
    // Score panel sits in the header while nothing is selected; it fails in its own region.
    await expect(page.getByTestId('review-header').getByTestId('score-panel')).toHaveCount(1)
    await expect(page.getByTestId('review-header').getByTestId('score-panel')).toContainText(`Error: ${DELTA_ERROR}`)
    await expect(page.getByTestId('review-header').getByRole('button', { name: 'Refresh' })).toBeVisible()
    await expect(page.getByRole('button', { name: '← Back to ARTs' })).toBeVisible()
    await shot(page, '05-delta-error')
  })

  test('E-R9 reportError iteration (team-1 Sprint 1) shows its verbatim message in the chart region', async ({ page }) => {
    await gotoGroupList(page)
    await openTile(page, 'team-1')
    await expect(page.getByTestId('review-header')).toContainText('Team One')
    await expect(page.getByTestId('review-header')).toContainText(TEAM1)
    await expect(page.locator('canvas')).toBeVisible()
    await selectIteration(page, 'Sprint 1')
    const card = page.getByTestId('chart-card')
    await expect(card.getByText(TEAM1_REPORT_ERROR, { exact: true })).toBeVisible()
    await expect(card.locator('canvas')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Burndown' })).toHaveCount(0)
    // Other regions intact.
    await expect(card.getByTestId('score-panel')).toContainText('Average over the last 4 sprints')
    await expect(page.getByTestId('annotations-rail')).toContainText('No annotation for this iteration')
  })

  test('E-R10 report: null (alpha Sprint 1) shows the no-burnup-data literal', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await selectIteration(page, 'Sprint 1')
    await expect(
      page.getByTestId('chart-card').getByText('No burnup data found for this iteration (check permissions or format).'),
    ).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
  })

  test('E-R11 score panel: heading + four figures matching §11.2 on the mock data', async ({ page, request }) => {
    const reports = await apiReports(request, ALPHA)
    const closed = reports.filter((r) => r.state === 'closed').slice(0, 4)
    const recs = closed
      .filter((r) => r.report && r.report.totals.committed.weight > 0)
      .map((r) => {
        const c = r.report!.totals.committed.weight
        const d = r.report!.totals.delivered.weight
        return { dev: Math.abs(c - d) / c, diff: c - d, delivered: d }
      })
    const avgDev = (recs.reduce((s, r) => s + r.dev, 0) / recs.length) * 100
    const avgDiff = recs.reduce((s, r) => s + r.diff, 0) / recs.length
    const compliant = (recs.filter((r) => r.dev < 0.1).length / recs.length) * 100
    const ds = recs.map((r) => r.delivered).sort((a, b) => a - b)
    const median = ds.length % 2 ? ds[(ds.length - 1) / 2] : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2
    const tone = (v: number, g: number, c: number) => (v <= g ? 'good' : v <= c ? 'caution' : 'poor')

    await gotoGroupList(page)
    await openCard(page, 'alpha')
    const panel = page.getByTestId('chart-card').getByTestId('score-panel')
    await expect(panel).toContainText('Average over the last 4 sprints')
    await expect(page.getByTestId('review-header').getByTestId('score-panel')).toHaveCount(0)
    const dd = panel.locator('dd')
    await expect(dd).toHaveCount(4)
    await expect(panel.locator('dt')).toHaveText(['Average deviation', 'Delivery diff.', 'Compliant sprints', 'Median velocity'])
    await expect(dd.nth(0)).toHaveText(`${avgDev.toFixed(1)} %`)
    await expect(dd.nth(1)).toHaveText(`${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(1)} pts`)
    await expect(dd.nth(2)).toHaveText(`${Math.round(compliant)} %`)
    await expect(dd.nth(3)).toHaveText(`${median.toFixed(1)} pts`)
    await expect(dd.nth(0)).toHaveAttribute('data-tone', tone(avgDev, 10, 20))
    await expect(dd.nth(1)).toHaveAttribute('data-tone', tone(Math.abs(avgDiff), 2, 5))
    await expect(dd.nth(2)).toHaveAttribute('data-tone', compliant >= 70 ? 'good' : compliant >= 50 ? 'caution' : 'poor')
    expect(await dd.nth(3).getAttribute('data-tone')).toBeNull()
  })
})
