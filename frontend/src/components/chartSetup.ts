// Chart.js registration (tree-shaken build) and the chart theme. A canvas cannot read CSS variables, so
// useChartTheme() reads the design tokens (src/index.css) from <html> at runtime and re-reads them whenever
// `data-theme` changes; the components only ever receive token values ("no colour in code", STYLEGUIDE.md §1).
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
import { useEffect, useState } from 'react'

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

/** Token values the charts paint with. */
export interface ChartTheme {
  font: string
  text: string
  textSecondary: string
  separator: string
  card: string
  tooltipBg: string
  remaining: string
  forecast: string
  today: string
  ideal: string
  tolerance: string
  delivered: string
  totalScope: string
  info: string
  risk: string
}

/**
 * Token name per theme key, with the light value as a fallback for environments that do not compute CSS
 * (jsdom). The fallbacks are copies of STYLEGUIDE.md §13 (light) — the stylesheet stays the source of truth.
 */
const TOKENS: Record<keyof ChartTheme, [string, string]> = {
  font: ['--font', "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"],
  text: ['--text', '#1d1d1f'],
  textSecondary: ['--text-secondary', 'rgba(60, 60, 67, 0.6)'],
  separator: ['--separator', 'rgba(60, 60, 67, 0.12)'],
  card: ['--card', '#ffffff'],
  tooltipBg: ['--tooltip-bg', 'rgba(246, 246, 248, 0.97)'],
  remaining: ['--remaining', '#007aff'],
  forecast: ['--forecast', '#ff9500'],
  today: ['--today', '#ff3b30'],
  ideal: ['--ideal', '#aeaeb2'],
  tolerance: ['--tolerance', '#34c759'],
  delivered: ['--delivered', '#34c759'],
  totalScope: ['--total-scope', 'rgba(60, 60, 67, 0.6)'],
  info: ['--info', '#007aff'],
  risk: ['--risk', '#ff3b30'],
}

/** Reads the current token values from <html>. */
export function readChartTheme(root: HTMLElement = document.documentElement): ChartTheme {
  const style = getComputedStyle(root)
  const theme = {} as ChartTheme
  for (const [key, [token, fallback]] of Object.entries(TOKENS) as [keyof ChartTheme, [string, string]][]) {
    theme[key] = resolveVar(style, style.getPropertyValue(token).trim()) || fallback
  }
  return theme
}

const VAR_REF = /var\(\s*(--[\w-]+)\s*\)/g

/** Browsers substitute var() in computed custom properties; engines that do not (jsdom) get it done here. */
function resolveVar(style: CSSStyleDeclaration, value: string, depth = 0): string {
  if (depth > 8 || !value.includes('var(')) return value
  return resolveVar(
    style,
    value.replace(VAR_REF, (_, name: string) => style.getPropertyValue(name).trim()),
    depth + 1,
  )
}

const sameTheme = (a: ChartTheme, b: ChartTheme) =>
  (Object.keys(TOKENS) as (keyof ChartTheme)[]).every((k) => a[k] === b[k])

/** The chart theme, re-read when the appearance (`data-theme` on <html>) changes. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(readChartTheme)
  useEffect(() => {
    const root = document.documentElement
    const update = () => setTheme((prev) => {
      const next = readChartTheme(root)
      return sameTheme(prev, next) ? prev : next
    })
    // The stylesheet may have loaded after the first read.
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

/** A token colour (`#rgb`, `#rrggbb`, `rgb()` or `rgba()`) at `alpha` × its own opacity, as rgba(). */
export function tint(colour: string, alpha: number): string {
  const c = colour.trim()
  if (c.startsWith('#')) {
    const hex = c.length === 4 ? [...c.slice(1)].map((d) => d + d).join('') : c.slice(1, 7)
    const n = Number.parseInt(hex, 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(c)
  if (m) {
    const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean)
    return `rgba(${r}, ${g}, ${b}, ${Number(a) * alpha})`
  }
  return c
}

export const DASH = [6, 4]
/** Burnup committed-workload reference: its own, finer dash so it is never confused with Ideal. */
export const SCOPE_DASH = [2, 3]

/** Shared axis look (§3, §4): 12 px secondary ticks, hairline grid in the separator colour. */
export function axisStyle(t: ChartTheme) {
  return {
    ticks: { color: t.textSecondary, font: { family: t.font, size: 12 } },
    grid: { color: t.separator },
    border: { color: t.separator },
  }
}

/**
 * Chart title: 13 / 600 in the text colour. The review screen shows the title as an HTML heading above the
 * delivery summary (so the canvas one is hidden there); the text stays configured on the chart.
 */
export function titleStyle(t: ChartTheme, text: string, display = true) {
  return { display, text, color: t.text, font: { family: t.font, size: 13, weight: 600 as const } }
}

/** Tooltip (§7): near-opaque popover surface, radius 10, padding 12 × 14, 13 / 600 title and 12 px lines. */
export function tooltipStyle(t: ChartTheme) {
  return {
    backgroundColor: t.tooltipBg,
    borderColor: t.separator,
    borderWidth: 1,
    titleColor: t.text,
    bodyColor: t.textSecondary,
    footerColor: t.text,
    titleFont: { family: t.font, size: 13, weight: 600 as const },
    bodyFont: { family: t.font, size: 12 },
    footerFont: { family: t.font, size: 12, weight: 400 as const },
    padding: { top: 12, bottom: 12, left: 14, right: 14 },
    cornerRadius: 10,
    boxPadding: 4,
  }
}

/**
 * Legend swatches drawn as what they stand for: a dashed (or line-styled) series as a line, a filled series as a box
 * (instead of Chart.js's solid block for every series). 12 px secondary text, 16 px apart (§7 Legend).
 */
export function legendStyle(t: ChartTheme) {
  return {
    position: 'bottom',
    labels: {
      color: t.textSecondary,
      font: { family: t.font, size: 12 },
      padding: 16,
      usePointStyle: true,
      // Swatches 18 × 8 (§7 Legend).
      boxHeight: 8,
      pointStyleWidth: 18,
      generateLabels: (chart: Chart) =>
        Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => {
          // With usePointStyle Chart.js styles the swatch from a point, which carries no dash: take the series'.
          const dataset = chart.data.datasets[item.datasetIndex ?? 0] as { borderDash?: number[]; pointStyle?: unknown }
          const dash = dataset.borderDash ?? []
          // A dashed series, or one that declares itself a line (pointStyle 'line'), gets a line swatch.
          const line = dash.length > 0 || dataset.pointStyle === 'line'
          return {
            ...item,
            fontColor: t.textSecondary,
            lineDash: dash,
            pointStyle: line ? ('line' as const) : ('rectRounded' as const),
          }
        }),
    },
  } as const
}

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
