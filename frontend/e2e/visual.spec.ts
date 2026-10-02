// Things only a real canvas / real layout can show: tooltip, callout visibility, responsive layout, colours.
import {
  ALPHA,
  apiReports,
  calloutBoxes,
  chartSnapshot,
  expect,
  gotoGroupList,
  openCard,
  seedAnnotation,
  seedStorage,
  selectIteration,
  shot,
  test,
  tooltipState,
} from './helpers'

test.describe('E-V real-canvas checks', () => {
  test('E-V1 hovering an annotated point lists every annotation text of that date in the tooltip', async ({ page, request }) => {
    const reports = await apiReports(request, ALPHA)
    const s6 = reports.find((r) => r.iid === '6')!
    const date = s6.report!.series[4].date
    await seedStorage(page, [
      seedAnnotation(ALPHA, '6', date, 'First note', 'information', '1'),
      seedAnnotation(ALPHA, '6', date, 'Second note', 'risk', '2'),
    ])
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await selectIteration(page, 'Sprint 6')
    await expect(page.getByTestId('annotation-item')).toHaveCount(2)
    const snap = await chartSnapshot(page)
    const i = snap.labels.indexOf(date)
    await page.mouse.move(snap.points[i].x, snap.points[i].y)
    await expect.poll(async () => (await tooltipState(page)).opacity).toBeGreaterThan(0)
    const t = await tooltipState(page)
    expect(t.title).toEqual([date])
    expect(t.footer).toEqual(['First note', 'Second note'])
    // A point with no annotation has no footer lines.
    const j = snap.labels.indexOf(s6.report!.series[1].date)
    await page.mouse.move(snap.points[j].x, snap.points[j].y)
    await expect.poll(async () => (await tooltipState(page)).title).toEqual([s6.report!.series[1].date])
    expect((await tooltipState(page)).footer).toEqual([])
    // Clicking the annotated point opens the FIRST annotation for editing (ledger #13).
    await page.mouse.click(snap.points[i].x, snap.points[i].y)
    const dlg = page.getByTestId('annotation-dialog')
    await expect(dlg.getByRole('heading', { name: 'Edit annotation' })).toBeVisible()
    await expect(dlg.getByPlaceholder('Explain the deviation...')).toHaveValue('First note')
  })

  test('E-V2 layout per §3.2 at 1440/1280: left rail | centre | right rail; gutter inside the canvas; no horizontal scroll', async ({ page }) => {
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: 1000 })
      await gotoGroupList(page)
      await openCard(page, 'alpha')
      await expect(page.getByTestId('deviation-gutter')).toHaveAttribute('data-placed', 'true')
      const left = (await page.getByTestId('iteration-rail').boundingBox())!
      const centre = (await page.getByTestId('chart-card').boundingBox())!
      const right = (await page.getByTestId('annotations-rail').boundingBox())!
      expect(left.x + left.width).toBeLessThanOrEqual(centre.x)
      expect(centre.x + centre.width).toBeLessThanOrEqual(right.x)
      expect(Math.abs(left.y - centre.y)).toBeLessThan(2)
      expect(Math.abs(right.y - centre.y)).toBeLessThan(2)
      expect(centre.width).toBeGreaterThan(left.width)
      expect(centre.width).toBeGreaterThan(right.width)
      const snap = await chartSnapshot(page)
      for (const el of await page.getByTestId('deviation-label').all()) {
        const b = (await el.boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(snap.canvasRect.x + snap.chartArea.right)
        expect(b.x + b.width).toBeLessThanOrEqual(centre.x + centre.width)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.getByRole('button', { name: '← Back to ARTs' }).click()
    }
  })

  test('E-V3 narrow (1024): rails reflow, gutter labels still beside the plot and unclipped', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1100 })
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await expect(page.getByTestId('deviation-gutter')).toHaveAttribute('data-placed', 'true')
    const snap = await chartSnapshot(page)
    for (const el of await page.getByTestId('deviation-label').all()) {
      const b = (await el.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(snap.canvasRect.x + snap.chartArea.right)
      expect(b.x + b.width).toBeLessThanOrEqual(snap.canvasRect.x + snap.canvasRect.width + 0.5)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await shot(page, '06-review-1024')
  })

  test('E-V4 [defect D1] a single annotation callout is drawn inside the plot (visible)', async ({ page, request }) => {
    // §3.6 "Annotation text is drawn as a callout box anchored to its point"; §10.5 KNOWN BEHAVIOUR only expects
    // labels to vanish on CROWDED iterations. With 20-workload-unit offsets on a ~50-point range, even a lone
    // label in the upper or lower part of the range is pushed outside the chart area and clipped.
    test.fail(true, 'D1: lone callouts are pushed outside the plot and clipped (BurndownChart workloadOffsetToPixels + clip)')
    const reports = await apiReports(request, ALPHA)
    const s6 = reports.find((r) => r.iid === '6')!
    const pts = s6.report!.series
    const seeds = [0, 3, 6, 9, 12].filter((i) => i < pts.length).map((i, k) =>
      seedAnnotation(ALPHA, '6', pts[i].date, `Note ${k} at ${pts[i].remaining}`, k % 2 ? 'risk' : 'information', String(100 + k)),
    )
    await seedStorage(page, seeds)
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await selectIteration(page, 'Sprint 6')
    await expect(page.getByTestId('annotation-item')).toHaveCount(seeds.length)
    await chartSnapshot(page)
    await shot(page, '04-callouts-clipped')
    const { area, boxes } = await calloutBoxes(page)
    expect(boxes).toHaveLength(seeds.length)
    // A callout counts as hidden when less than 90 % of its box lies inside the (clipped) plot area.
    const visibleShare = (b: { y: number; y2: number }) =>
      Math.max(0, Math.min(b.y2, area.bottom) - Math.max(b.y, area.top)) / (b.y2 - b.y)
    const hidden = boxes.filter((b) => visibleShare(b) < 0.9).map((b) => String(b.content))
    expect(hidden, 'callouts clipped away outside the plot area').toEqual([])
  })
})
