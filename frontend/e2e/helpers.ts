// Shared helpers for the e2e specs: navigation, fixture constants, and access to the live Chart.js instance.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type APIRequestContext, type Page, test as base, expect } from '@playwright/test'

/** `test` with an automatic guard: any uncaught page error or console error fails the test. */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
      page.on('console', (m) => {
        // The browser's own network log for an intended HTTP error (e.g. delta's 502) is not an app error.
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console.error: ${m.text()}`)
      })
      await use()
      expect(problems, 'no uncaught errors / console errors').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

export const ROOT = 'org/delivery'
export const ALPHA = 'org/delivery/alpha'
export const TEAM1 = 'org/delivery/alpha/team-1'
export const BETA_X = 'org/delivery/beta/x'
export const DELTA = 'org/delivery/delta'

// Verbatim messages of the mock (backend/internal/mock/fixture.go).
export const TEAM1_REPORT_ERROR = 'Burnup chart could not be generated due to too many events'
export const DELTA_ERROR =
  "The resource that you are attempting to access does not exist or you don't have permission to perform this action"

/** Light-appearance token values (src/index.css = STYLEGUIDE.md §2) the canvas is painted with. */
export const COLOURS = {
  BLUE: '#007aff', // --remaining, --info
  TODAY: '#ff3b30', // --today (red)
  FORECAST: '#ff9500', // --forecast (orange)
  GREY: '#aeaeb2', // --ideal (= --undated)
  GREEN: '#34c759', // --tolerance, --delivered
  NEUTRAL: 'rgba(60, 60, 67, 0.6)', // --total-scope (= --text-secondary)
  RED: '#ff3b30', // --risk
  CARD: '#ffffff', // --card
}

/** Dark-appearance values of the same tokens. */
export const DARK_COLOURS = {
  BLUE: '#0a84ff',
  TODAY: '#ff453a',
  FORECAST: '#ff9f0a',
  GREY: '#636366',
  GREEN: '#30d158',
  RED: '#ff453a',
  CARD: '#1c1c1e',
}

export const SHOT_DIR = process.env.E2E_SHOT_DIR ?? join(process.cwd(), 'test-results', 'screenshots')

export async function shot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true })
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface ApiIteration {
  id: string
  iid: string
  title: string
  startDate: string
  dueDate: string
  state: string
}

export async function apiIterations(request: APIRequestContext, group: string): Promise<ApiIteration[]> {
  const res = await request.get(`http://localhost:8080/api/iterations?group=${encodeURIComponent(group)}`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

export interface ApiTotal {
  weight: number
  count: number
}
export interface ApiReport extends ApiIteration {
  report: {
    series: { date: string; committed: number; delivered: number; remaining: number }[]
    totals: { committed: ApiTotal; delivered: ApiTotal; inProgress: ApiTotal }
  } | null
  reportError: string | null
}

export async function apiReports(request: APIRequestContext, group: string): Promise<ApiReport[]> {
  const res = await request.get(`http://localhost:8080/api/reports?group=${encodeURIComponent(group)}`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

/** Fresh visit: empty localStorage unless `keepStorage`. Waits for the populated group list. */
export async function gotoGroupList(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /^Available Teams \(\d+\)$/ })).toBeVisible()
}

export async function openCard(page: Page, segment: string) {
  await page.getByTestId('group-card').filter({ has: page.locator('.category', { hasText: new RegExp(`^${segment}$`) }) })
    .locator('.group-card-main').click()
  await expect(page.getByTestId('review-header')).toBeVisible()
}

export async function openTile(page: Page, segment: string) {
  await page.getByTestId('group-tile').filter({ has: page.locator('.tile-segment', { hasText: new RegExp(`^${segment}$`) }) }).click()
  await expect(page.getByTestId('review-header')).toBeVisible()
}

export async function selectIteration(page: Page, title: string) {
  await page.getByTestId('iteration-row').filter({ hasText: title }).click()
  await expect(page.getByTestId('chart-card').locator('.iteration-header h2')).toHaveText(title)
}

export interface ChartSnapshot {
  type: string
  title: string
  chartArea: { left: number; top: number; right: number; bottom: number }
  canvasRect: { x: number; y: number; width: number; height: number }
  labels: string[]
  datasets: { label: string; data: (number | null)[]; borderColor: unknown; pointBackgroundColor: unknown; borderDash: unknown }[]
  /** Page-coordinate centre of each Remaining/Completed point (dataset 0). */
  points: { x: number; y: number; skip: boolean }[]
  annotations: { id: string; type: string; content: unknown; drawTime: unknown; backgroundColor: unknown; borderColor: unknown; yMin: unknown }[]
  legend: string[]
  dataUrlLength: number
  /** Pixel y of `value` on the y scale, in page coordinates. */
  yPixels: Record<string, number>
}

/**
 * Reads the live Chart.js instance behind the (single) canvas. The chart module is imported from the exact
 * URL Vite served it under, so `Chart.getChart` sees the same instance registry as the app.
 */
export async function chartSnapshot(page: Page, yValues: number[] = []): Promise<ChartSnapshot> {
  await page.locator('canvas').waitFor()
  return page.evaluate(async (yValues) => {
    const url = performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .find((n) => /\/node_modules\/\.vite\/deps\/chart__js\.js/.test(n))
    if (!url) throw new Error('chart.js module URL not found')
    const mod = await import(/* @vite-ignore */ url)
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    // Poll briefly: react-chartjs-2 builds the chart in an effect.
    let chart = mod.Chart.getChart(canvas)
    for (let i = 0; !chart && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 50))
      chart = mod.Chart.getChart(canvas)
    }
    if (!chart) throw new Error('no chart instance on the canvas')
    const rect = canvas.getBoundingClientRect()
    const meta = chart.getDatasetMeta(0)
    const ann = chart.options.plugins?.annotation?.annotations ?? {}
    const entries: [string, Record<string, unknown>][] = Array.isArray(ann)
      ? ann.map((a: Record<string, unknown>, i: number) => [String(i), a])
      : (Object.entries(ann) as [string, Record<string, unknown>][])
    const yPixels: Record<string, number> = {}
    for (const v of yValues) yPixels[String(v)] = rect.y + chart.scales.y.getPixelForValue(v)
    return {
      type: chart.config.type,
      title: String(chart.options.plugins?.title?.text ?? ''),
      chartArea: { ...chart.chartArea },
      canvasRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      labels: chart.data.labels as string[],
      datasets: chart.data.datasets.map((d: Record<string, unknown>) => ({
        label: d.label,
        data: d.data,
        borderColor: d.borderColor,
        pointBackgroundColor: d.pointBackgroundColor,
        borderDash: d.borderDash,
      })),
      points: meta.data.map((p: { x: number; y: number; skip: boolean }) => ({ x: rect.x + p.x, y: rect.y + p.y, skip: p.skip })),
      annotations: entries.map(([id, a]: [string, Record<string, unknown>]) => ({
        id,
        type: a.type as string,
        content: a.content,
        drawTime: a.drawTime,
        backgroundColor: a.backgroundColor,
        borderColor: a.borderColor,
        yMin: a.yMin,
      })),
      legend: (chart.legend?.legendItems ?? []).map((i: { text: string }) => i.text),
      dataUrlLength: canvas.toDataURL('image/png').length,
      yPixels,
    }
  }, yValues) as Promise<ChartSnapshot>
}

/** Clicks the Remaining (burndown) / Completed (burnup) point drawn for `date`. */
export async function clickPoint(page: Page, date: string) {
  const snap = await chartSnapshot(page)
  const i = snap.labels.indexOf(date)
  if (i < 0) throw new Error(`date ${date} not on the axis`)
  const p = snap.points[i]
  if (p.skip) throw new Error(`no drawn point at ${date}`)
  await page.mouse.click(p.x, p.y)
}

/** Distinct-colour count + luminance variance of a canvas screenshot: a blank canvas has ~1 colour. */
export async function canvasPixelStats(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    const colours = new Set<number>()
    let sum = 0
    let sumSq = 0
    let n = 0
    let opaque = 0
    for (let i = 0; i < data.length; i += 16) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
      colours.add((r << 24) | (g << 16) | (b << 8) | a)
      const l = a === 0 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b
      sum += l
      sumSq += l * l
      n++
      if (a > 0) opaque++
    }
    const mean = sum / n
    return { colours: colours.size, variance: sumSq / n - mean * mean, opaqueShare: opaque / n }
  })
}

/** Is a pixel near (x, y) in page coordinates within `tol` of `hex`? Reads the canvas backing store. */
export async function canvasHasColourNear(page: Page, x: number, y: number, hex: string, radius = 4, tol = 40) {
  return page.evaluate(
    ({ x, y, hex, radius, tol }) => {
      const c = document.querySelector('canvas') as HTMLCanvasElement
      const rect = c.getBoundingClientRect()
      const scale = c.width / rect.width
      const ctx = c.getContext('2d')!
      const cx = Math.round((x - rect.x) * scale)
      const cy = Math.round((y - rect.y) * scale)
      const r = Math.round(radius * scale)
      const { data, width } = ctx.getImageData(cx - r, cy - r, 2 * r + 1, 2 * r + 1)
      const n = Number.parseInt(hex.slice(1), 16)
      const want = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue
        if (Math.abs(data[i] - want[0]) + Math.abs(data[i + 1] - want[1]) + Math.abs(data[i + 2] - want[2]) <= tol) return true
      }
      void width
      return false
    },
    { x, y, hex, radius, tol },
  )
}

/** Current tooltip state of the live chart (title + footer lines), after a hover. */
export async function tooltipState(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .find((n) => n.includes('/node_modules/.vite/deps/chart__js.js'))
    const mod = await import(/* @vite-ignore */ url!)
    const chart = mod.Chart.getChart(document.querySelector('canvas') as HTMLCanvasElement)
    const t = chart.tooltip
    return { opacity: t.opacity as number, title: t.title as string[], footer: t.footer as string[] }
  })
}

/** Drawn boxes of the burndown callout labels (canvas pixels) and the chart area, from the annotation plugin. */
export async function calloutBoxes(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .find((n) => n.includes('/node_modules/.vite/deps/chart__js.js'))
    const mod = await import(/* @vite-ignore */ url!)
    const chart = mod.Chart.getChart(document.querySelector('canvas') as HTMLCanvasElement)
    const plugin = mod.Chart.registry.getPlugin('annotation') as { getAnnotations(c: unknown): { x: number; y: number; x2: number; y2: number; options: { type: string; content: unknown } }[] }
    const els = plugin.getAnnotations(chart).filter((e) => e.options.type === 'label')
    return {
      area: { ...chart.chartArea } as { left: number; top: number; right: number; bottom: number },
      boxes: els.map((e) => ({ x: e.x, y: e.y, x2: e.x2, y2: e.y2, content: e.options.content })),
    }
  })
}

export function seedAnnotation(groupPath: string, iterationId: string, date: string, text: string, type: 'information' | 'risk', id: string) {
  return { id, groupPath, iterationId, date, author: 'Current User', text, type, createdAt: new Date().toISOString() }
}

export async function seedStorage(page: Page, list: unknown[]) {
  await page.goto('/')
  await page.evaluate((l) => localStorage.setItem('heimdall-annotations.v1', JSON.stringify(l)), list)
}

/**
 * Text and background colour of an element as sRGB 0–255 triples (computed `rgb()` or `color(srgb …)` — the
 * latter is how Chromium serialises color-mix()), plus their WCAG contrast ratio.
 */
export async function textColours(page: Page, selector: string) {
  const [color, background] = await page.locator(selector).evaluate((e) => {
    const s = getComputedStyle(e)
    return [s.color, s.backgroundColor]
  })
  const fg = parseCssColour(color)
  const bg = parseCssColour(background)
  return { fg, bg, contrast: contrastRatio(fg, bg) }
}

function parseCssColour(value: string): [number, number, number] {
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(value)
  if (srgb) return [1, 2, 3].map((i) => Number(srgb[i]) * 255) as [number, number, number]
  const rgb = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(value)
  if (rgb) return [1, 2, 3].map((i) => Number(rgb[i])) as [number, number, number]
  throw new Error(`unparsed colour ${value}`)
}

function contrastRatio(a: number[], b: number[]): number {
  const lum = (c: number[]) =>
    c
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
