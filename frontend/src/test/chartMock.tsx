// Stand-in for react-chartjs-2 in jsdom (no canvas). Test files install it with
//   vi.mock('react-chartjs-2', () => import('../test/chartMock'))
// The production code MUST render its charts with `<Line data={…} options={…} />` from react-chartjs-2
// (both views); this mock records the props of the latest render so tests can assert the datasets,
// options (annotation plugin config, tooltip callbacks, title, onClick) exactly as Chart.js would get them.
// Test-only.

export interface CapturedDataset {
  label: string
  data: unknown[]
  [key: string]: any
}

export interface CapturedLineProps {
  data: { labels?: unknown[]; datasets: CapturedDataset[] }
  options?: any
  plugins?: unknown[]
  [key: string]: any
}

const state: { last: CapturedLineProps | null; renders: number } = { last: null, renders: 0 }

export function Line(props: CapturedLineProps) {
  state.last = props
  state.renders += 1
  return <div data-testid="chart-line" />
}

/** Clears the captured props (call in beforeEach). */
export function resetChartMock(): void {
  state.last = null
  state.renders = 0
}

/** Props of the most recent `<Line>` render; throws when no chart has been rendered. */
export function lastLineProps(): CapturedLineProps {
  if (!state.last) throw new Error('no <Line> chart has been rendered')
  return state.last
}

/** The dataset whose `label` (= legend entry, §3.2) equals `label`. */
export function datasetByLabel(label: string): CapturedDataset {
  const found = lastLineProps().data.datasets.find((d) => d.label === label)
  if (!found) throw new Error(`no dataset labelled ${label}`)
  return found
}

/** Legend entries, in dataset order. */
export function datasetLabels(): string[] {
  return lastLineProps().data.datasets.map((d) => d.label)
}

/** chartjs-plugin-annotation entries (`options.plugins.annotation.annotations`, object map or array). */
export function annotationEntries(): any[] {
  const a = lastLineProps().options?.plugins?.annotation?.annotations
  if (!a) return []
  return Array.isArray(a) ? a : Object.values(a)
}

/** Text of an annotation-plugin label entry's `content` (string | string[]), lines joined by '\n'. */
export function contentText(entry: any): string {
  const c = entry?.content ?? entry?.label?.content
  if (c === undefined || c === null) return ''
  return (Array.isArray(c) ? c : [c]).join('\n')
}

/** Simulates Chart.js calling `options.onClick(event, activeElements, chart)` on the point at `index`. */
export function clickChartAt(index: number): void {
  const props = lastLineProps()
  const onClick = props.options?.onClick
  if (typeof onClick !== 'function') throw new Error('options.onClick is not a function')
  const elements = [{ index, datasetIndex: 0, element: {} }]
  onClick({ type: 'click', native: null, x: 0, y: 0 }, elements, {})
}

/** Calls `options.plugins.tooltip.callbacks.footer` for the point at `index`; returns its lines joined by '\n'. */
export function tooltipFooterAt(index: number): string {
  const props = lastLineProps()
  const footer = props.options?.plugins?.tooltip?.callbacks?.footer
  if (typeof footer !== 'function') throw new Error('options.plugins.tooltip.callbacks.footer is not a function')
  const label = props.data.labels?.[index]
  const items = [{ dataIndex: index, index, datasetIndex: 0, label, parsed: { x: index, y: 0 }, raw: null }]
  const out = footer(items)
  if (out === undefined || out === null) return ''
  return (Array.isArray(out) ? out : [out]).join('\n')
}

/** Index of an ISO date on the chart's x axis (`data.labels`). */
export function indexOfDate(date: string): number {
  const i = (lastLineProps().data.labels ?? []).indexOf(date)
  if (i < 0) throw new Error(`date ${date} is not on the chart axis`)
  return i
}
