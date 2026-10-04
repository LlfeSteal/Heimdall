// Burndown view (SPEC §7.4, §7.5, §9, §3.6, §10.5): Remaining / Ideal / Forecast, tolerance line, annotation
// callouts, and the deviation-label gutter positioned from the chart's real y scale.
import type { Chart, ChartData, ChartOptions, Plugin, Scale, TooltipItem } from 'chart.js'
import type { AnnotationOptions, PartialEventContext } from 'chartjs-plugin-annotation'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import type { IterationReport } from '../api/types'
import { type Annotation, annotationsOnDate, effectiveType } from '../annotations/model'
import {
  annotationLabelSize,
  horizontalPushSign,
  stackAnnotationLabels,
  verticalPushSign,
} from '../domain/annotationGeometry'
import { todayUtc } from '../domain/dates'
import { placeDeviationLabels } from '../domain/deviationLabels'
import { type BurndownModel, buildBurndownModel } from '../domain/model'
import { S } from '../strings'
import { CALLOUT_GAP_PX, type CalloutBand, calloutLeft, calloutLines, widenRangeForCallouts } from './calloutLayout'
import {
  type ChartTheme,
  DASH,
  axisStyle,
  legendStyle,
  pointClickHandler,
  tint,
  titleStyle,
  tooltipStyle,
  useChartTheme,
} from './chartSetup'
import { DeviationGutter } from './DeviationGutter'

const GUTTER_WIDTH = 112
const GUTTER_LABEL_HEIGHT = 20
/** Horizontal callout push, as a share of the chart width (§10.5 "proportional to the chart width"). */
const PUSH_RATIO = 0.04

interface Props {
  iteration: IterationReport
  /** The group's whole report list (forecast history, §6). */
  reports: IterationReport[]
  annotations: Annotation[]
  onPointClick: (date: string) => void
}

export function BurndownChart({ iteration, reports, annotations, onPointClick }: Props) {
  const today = todayUtc()
  const theme = useChartTheme()
  const model = useMemo(
    () => buildBurndownModel({ iteration, iterations: reports, today }),
    [iteration, reports, today],
  )

  // Latest click handler and gutter values, read by Chart.js callbacks (never during render), so the chart
  // options stay stable while the user types in the dialogue.
  const clickRef = useRef(onPointClick)
  const valuesRef = useRef<number[]>([])
  useLayoutEffect(() => {
    clickRef.current = onPointClick
    valuesRef.current = model.labels.map((l) => l.value)
  })

  const [positions, setPositions] = useState<number[] | null>(null)
  // Created once: react-chartjs-2 only reads `plugins` when the chart is first built.
  // oxlint-disable-next-line react/refs -- the ref is only read inside the plugin's afterLayout hook
  const [plugins] = useState<Plugin<'line'>[]>(() => [gutterPlugin(valuesRef, setPositions)])

  const data = useMemo(() => burndownData(model, theme), [model, theme])
  const options = useMemo(
    // oxlint-disable-next-line react/refs -- read only when Chart.js reports a click
    () => burndownOptions(model, annotations, theme, (date) => clickRef.current(date)),
    [model, annotations, theme],
  )

  return (
    <div className="chart-canvas">
      <Line data={data} options={options} plugins={plugins} role="img" aria-label={S.burndownTitle} />
      {model.reserveGutter && <DeviationGutter labels={model.labels} positions={positions} width={GUTTER_WIDTH} />}
    </div>
  )
}

function burndownData(m: BurndownModel, t: ChartTheme): ChartData<'line', (number | null)[], string> {
  return {
    labels: m.axis,
    datasets: [
      {
        label: S.legendRemaining,
        data: m.remaining,
        borderColor: t.remaining,
        backgroundColor: tint(t.remaining, 0.12),
        fill: 'origin',
        spanGaps: false,
        pointStyle: 'circle',
        pointRadius: 3,
        pointHoverRadius: 5,
        // Today's dot on a live iteration is red (§7.4; STYLEGUIDE.md §1: red means today).
        pointBackgroundColor: m.axis.map((_, i) => (i === m.todayIndex ? t.today : t.remaining)),
        pointBorderColor: m.axis.map((_, i) => (i === m.todayIndex ? t.today : t.remaining)),
      },
      {
        label: S.legendIdeal,
        data: m.ideal,
        borderColor: t.ideal,
        backgroundColor: t.ideal,
        borderDash: DASH,
        borderWidth: 1.5,
        pointStyle: 'line', // dashed swatch in the legend
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
      },
      {
        label: S.legendForecast,
        data: m.forecast,
        borderColor: t.forecast,
        backgroundColor: t.forecast,
        borderDash: DASH,
        borderWidth: 2,
        pointStyle: 'line',
        pointRadius: 0,
        pointHoverRadius: 0,
        spanGaps: true,
        fill: false,
      },
    ],
  }
}

function burndownOptions(
  m: BurndownModel,
  annotations: Annotation[],
  t: ChartTheme,
  onPointClick: (date: string) => void,
): ChartOptions<'line'> {
  const { entries, bands } = annotationEntries(m, annotations, t)
  const axis = axisStyle(t)
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { right: m.reserveGutter ? GUTTER_WIDTH : 0 } },
    scales: {
      x: axis,
      y: {
        ...axis,
        beginAtZero: true,
        // Ledger #11 as changed: widen the axis so every callout box stays inside the plot.
        afterDataLimits: (scale: Scale) => {
          const range = widenRangeForCallouts({ min: scale.min, max: scale.max }, bands, scale.height)
          scale.min = range.min
          scale.max = range.max
        },
      },
    },
    onClick: pointClickHandler(m.axis, m.remaining, onPointClick),
    plugins: {
      title: titleStyle(t, S.burndownTitle, false), // shown as the HTML heading of the chart head
      legend: legendStyle(t),
      tooltip: {
        ...tooltipStyle(t),
        callbacks: {
          // Every annotation text of the hovered date, one per line (§3.6, ledger #13).
          footer: (items: TooltipItem<'line'>[]) =>
            items.length ? annotationsOnDate(annotations, m.axis[items[0].dataIndex]).map((a) => a.text) : [],
        },
      },
      annotation: { annotations: entries },
    },
  }
}

/** Box border (px) — part of the drawn height on top of the §10.5 estimate. */
const CALLOUT_BORDER = 1

function annotationEntries(m: BurndownModel, annotations: Annotation[], t: ChartTheme) {
  const entries: Record<string, AnnotationOptions> = {}
  const bands: CalloutBand[] = []
  if (m.tolerance !== null) {
    entries.tolerance = {
      type: 'line',
      yMin: m.tolerance,
      yMax: m.tolerance,
      borderColor: t.tolerance,
      borderWidth: 1.5,
      borderDash: DASH,
      drawTime: 'beforeDatasetsDraw',
    }
  }

  const pointValue = (date: string) => {
    const i = m.axis.indexOf(date)
    return i < 0 ? null : m.remaining[i]
  }
  const items = annotations.map((a) => ({
    date: a.date,
    value: pointValue(a.date) ?? 0,
    height: annotationLabelSize(a.text).height,
  }))
  const range = workloadRange(m)

  for (const { index, date, offset } of stackAnnotationLabels(items, m.axis)) {
    const annotation = annotations[index]
    const { value } = items[index]
    const size = annotationLabelSize(annotation.text)
    const colour = effectiveType(annotation) === 'risk' ? t.risk : t.info
    const axisIndex = m.axis.indexOf(date)
    const hSign = horizontalPushSign(axisIndex, m.axis.length)
    const vSign = verticalPushSign(value, range.min, range.max)
    bands.push({ anchor: value + vSign * offset, direction: vSign, heightPx: size.height + CALLOUT_BORDER })
    entries[`note-${index}`] = {
      type: 'label',
      xValue: date,
      yValue: value, // the point: the dashed callout runs from the box back to it
      content: calloutLines(annotation.text),
      drawTime: 'beforeDatasetsDraw', // behind the data lines (§10.5)
      font: { family: t.font, size: 10, lineHeight: 1.3 },
      textAlign: 'start',
      // Mirrors the §10.5 estimate: 14 px horizontal and 10 px vertical padding, 13 px lines.
      padding: { top: 5, bottom: 5, left: 7, right: 7 },
      // Neutral card box; the type colour carries the meaning (border, text, callout line).
      color: colour,
      backgroundColor: t.card,
      borderColor: colour,
      borderWidth: CALLOUT_BORDER,
      borderRadius: 6,
      callout: { display: true, borderColor: colour, borderDash: [3, 3], borderWidth: 1 },
      // Box grows away from its point: upwards in the upper half of the range, downwards in the lower half.
      position: { x: 'start', y: vSign === 1 ? 'end' : 'start' },
      xAdjust: (ctx: PartialEventContext) => horizontalAdjust(ctx.chart, axisIndex, size.width + CALLOUT_BORDER, hSign),
      // Offsets are workload units (§10.5), converted to pixels through the (widened) y scale.
      yAdjust: (ctx: PartialEventContext) => workloadOffsetToPixels(ctx.chart, value, offset, vSign),
    }
  }
  return { entries, bands }
}

/** [min, max] of everything plotted (and 0, the axis starts there): the range §10.5's vertical rule refers to. */
function workloadRange(m: BurndownModel): { min: number; max: number } {
  const values = [0, ...m.remaining, ...m.ideal, ...m.forecast, m.tolerance].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
  return { min: Math.min(...values), max: Math.max(...values) }
}

function horizontalAdjust(chart: Chart, axisIndex: number, widthPx: number, sign: -1 | 1): number {
  const x = chart.scales?.x
  const area = chart.chartArea
  if (!x || !area) return 0
  const pointX = x.getPixelForValue(axisIndex)
  const push = Math.max(CALLOUT_GAP_PX, PUSH_RATIO * chart.width)
  return calloutLeft(pointX, widthPx, sign, push, area) - pointX
}

function workloadOffsetToPixels(chart: Chart, value: number, offset: number, sign: -1 | 1): number {
  const y = chart.scales?.y
  if (!y) return 0
  const pixels = Math.abs(y.getPixelForValue(value + offset) - y.getPixelForValue(value))
  return sign === 1 ? -pixels : pixels
}

/** Inline plugin: after every layout, place the gutter labels with the chart's real scale (§9). */
function gutterPlugin(
  valuesRef: { current: number[] },
  setPositions: (update: (prev: number[] | null) => number[] | null) => void,
): Plugin<'line'> {
  return {
    id: 'heimdallDeviationGutter',
    afterLayout(chart) {
      const values = valuesRef.current
      const y = chart.scales.y
      if (!y || values.length === 0) return
      const next = placeDeviationLabels({
        values,
        toPixel: (v) => y.getPixelForValue(v),
        plotTop: chart.chartArea.top,
        plotBottom: chart.chartArea.bottom,
        labelHeight: GUTTER_LABEL_HEIGHT,
      })
      setPositions((prev) => (samePositions(prev, next) ? prev : next))
    },
  }
}

function samePositions(a: number[] | null, b: number[]): boolean {
  return a !== null && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.5)
}
