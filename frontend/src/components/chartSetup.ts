// Chart.js registration (tree-shaken build) and the §13 colour semantics as concrete values for the canvas.
// The hex values mirror the tokens in src/index.css (a canvas cannot read CSS variables directly).
import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
  Title,
  annotationPlugin,
)

export const BLUE = '#2563eb' // remaining, primary accent, Information
export const ACCENT = '#f97316' // warm accent: today's dot, forecast, forecast label
export const GREY = '#9ca3af' // ideal reference
export const GREEN = '#16a34a' // tolerance line / label, delivered (burnup)
export const NEUTRAL = '#6b7280' // committed-workload reference (burnup total scope)
export const RED = '#dc2626' // Risk
export const AMBER = '#f59e0b' // burnup annotation markers

/** `#rrggbb` + alpha → rgba() for fills and label backgrounds. */
export function tint(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export const DASH = [6, 4]

/**
 * Legend swatches drawn as what they stand for: a dashed series as a dashed line, a filled series as a box
 * (instead of Chart.js's solid block for every series).
 */
export const LEGEND = {
  position: 'bottom',
  labels: {
    usePointStyle: true,
    pointStyleWidth: 28,
    generateLabels: (chart: Chart) =>
      Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => {
        // With usePointStyle Chart.js styles the swatch from a point, which carries no dash: take the series'.
        const dash = (chart.data.datasets[item.datasetIndex ?? 0] as { borderDash?: number[] }).borderDash ?? []
        return { ...item, lineDash: dash, pointStyle: dash.length ? ('line' as const) : ('rect' as const) }
      }),
  },
} as const

/**
 * Point-click handler shared by both views. Chart.js hands the active elements (nearest axis index); only an
 * index where the main series has a recorded value opens the dialogue, so a click on empty plot space after
 * the last point or in a gap does nothing (§3.6 "click a point").
 */
export function pointClickHandler(
  axis: readonly string[],
  series: readonly (number | null)[],
  onPointClick: (date: string) => void,
) {
  return (_event: unknown, elements: readonly { index: number }[]) => {
    const index = elements[0]?.index
    if (index === undefined || series[index] === null || series[index] === undefined) return
    onPointClick(axis[index])
  }
}
