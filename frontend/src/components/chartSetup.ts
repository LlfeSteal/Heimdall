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

/** Point-click handler shared by both views: Chart.js hands the active elements; the first one's index is the date. */
export function pointClickHandler(axis: readonly string[], onPointClick: (date: string) => void) {
  return (_event: unknown, elements: readonly { index: number }[]) => {
    const first = elements[0]
    if (first && axis[first.index] !== undefined) onPointClick(axis[first.index])
  }
}
