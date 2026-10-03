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
      await page.getByRole('button', { name: '← Back to Teams' }).click()
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

  test('E-V4 lone annotation callouts are drawn entirely inside the plot (D1 fixed: the y axis widens)', async ({ page, request }) => {
    // §3.6 "Annotation text is drawn as a callout box anchored to its point". Ledger #11 as changed on 2026-10-02:
    // offsets stay in workload units, but the y axis widens so every label box stays inside the chart.
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
    await shot(page, '04-callouts-visible')
    const { area, boxes } = await calloutBoxes(page)
    expect(boxes).toHaveLength(seeds.length)
    expect(outside(area, boxes), 'callout boxes reaching outside the plot area').toEqual([])
  })

  test('E-V5 crowded: 15 notes on one date and 3 on another — every callout box inside the plot', async ({ page, request }) => {
    const reports = await apiReports(request, ALPHA)
    const s6 = reports.find((r) => r.iid === '6')!
    const pts = s6.report!.series
    const first = pts[0].date
    const last = pts[pts.length - 1].date
    const seeds = [
      ...Array.from({ length: 15 }, (_, k) => seedAnnotation(ALPHA, '6', first, `Crowded ${k}\nsecond line`, 'information', String(200 + k))),
      ...Array.from({ length: 3 }, (_, k) => seedAnnotation(ALPHA, '6', last, `Low ${k} ${'long text '.repeat(6)}`, 'risk', String(300 + k))),
    ]
    await seedStorage(page, seeds)
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await selectIteration(page, 'Sprint 6')
    await expect(page.getByTestId('annotation-item')).toHaveCount(seeds.length)
    await chartSnapshot(page)
    await shot(page, '04b-callouts-crowded')
    const { area, boxes } = await calloutBoxes(page)
    expect(boxes).toHaveLength(seeds.length)
    expect(outside(area, boxes), 'callout boxes reaching outside the plot area').toEqual([])
    // §10.5 size: no box wider than the 25-character estimate (≈ 164 px) plus measuring slack.
    for (const b of boxes) expect(b.x2 - b.x).toBeLessThanOrEqual(175)
  })
})

/** Boxes not lying entirely inside the plot area (1 px tolerance for anti-aliasing / rounding). */
function outside(
  area: { left: number; top: number; right: number; bottom: number },
  boxes: { x: number; y: number; x2: number; y2: number; content: unknown }[],
): string[] {
  return boxes
    .filter((b) => b.y < area.top - 1 || b.y2 > area.bottom + 1 || b.x < area.left - 1 || b.x2 > area.right + 1)
    .map((b) => `${String(b.content)} [${b.x.toFixed(0)},${b.y.toFixed(0)} → ${b.x2.toFixed(0)},${b.y2.toFixed(0)}]`)
}
