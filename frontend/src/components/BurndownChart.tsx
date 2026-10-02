// Burndown view (SPEC §7.4, §7.5, §9, §3.6, §10.5): Remaining / Ideal / Forecast, tolerance line, annotation
// callouts, and the deviation-label gutter positioned from the chart's real y scale.
import type { Chart, ChartData, ChartOptions, Plugin, TooltipItem } from 'chart.js'
import type { AnnotationOptions, PartialEventContext } from 'chartjs-plugin-annotation'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import type { IterationReport } from '../api/types'
import { type Annotation, annotationsOnDate, effectiveType } from '../annotations/model'
import {
  ANNOTATION_LABEL,
  annotationLabelSize,
  horizontalPushSign,
  stackAnnotationLabels,
  verticalPushSign,
} from '../domain/annotationGeometry'
import { todayUtc } from '../domain/dates'
import { placeDeviationLabels } from '../domain/deviationLabels'
import { type BurndownModel, buildBurndownModel } from '../domain/model'
import { S } from '../strings'
import { ACCENT, BLUE, DASH, GREEN, GREY, RED, pointClickHandler, tint } from './chartSetup'
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

  const data = useMemo(() => burndownData(model), [model])
  const options = useMemo(
    // oxlint-disable-next-line react/refs -- read only when Chart.js reports a click
    () => burndownOptions(model, annotations, (date) => clickRef.current(date)),
    [model, annotations],
  )

  return (
    <div className="chart-canvas">
      <Line data={data} options={options} plugins={plugins} />
      {model.reserveGutter && <DeviationGutter labels={model.labels} positions={positions} width={GUTTER_WIDTH} />}
    </div>
  )
}

function burndownData(m: BurndownModel): ChartData<'line', (number | null)[], string> {
  return {
    labels: m.axis,
    datasets: [
      {
        label: S.legendRemaining,
        data: m.remaining,
        borderColor: BLUE,
        backgroundColor: tint(BLUE, 0.12),
        fill: 'origin',
        spanGaps: false,
        pointRadius: 3,
        pointHoverRadius: 5,
        // Today's dot on a live iteration takes the warm accent (§7.4, §13).
        pointBackgroundColor: m.axis.map((_, i) => (i === m.todayIndex ? ACCENT : BLUE)),
        pointBorderColor: m.axis.map((_, i) => (i === m.todayIndex ? ACCENT : BLUE)),
      },
      {
        label: S.legendIdeal,
        data: m.ideal,
        borderColor: GREY,
        backgroundColor: GREY,
        borderDash: DASH,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      },
      {
        label: S.legendForecast,
        data: m.forecast,
        borderColor: ACCENT,
        backgroundColor: ACCENT,
        borderDash: DASH,
        borderWidth: 2,
        pointRadius: 0,
        spanGaps: true,
        fill: false,
      },
    ],
  }
}

function burndownOptions(
  m: BurndownModel,
  annotations: Annotation[],
  onPointClick: (date: string) => void,
): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { right: m.reserveGutter ? GUTTER_WIDTH : 0 } },
    scales: { y: { beginAtZero: true } },
    onClick: pointClickHandler(m.axis, onPointClick),
    plugins: {
      title: { display: true, text: S.burndownTitle },
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          // Every annotation text of the hovered date, one per line (§3.6, ledger #13).
          footer: (items: TooltipItem<'line'>[]) =>
            items.length ? annotationsOnDate(annotations, m.axis[items[0].dataIndex]).map((a) => a.text) : [],
        },
      },
      annotation: { annotations: annotationEntries(m, annotations) },
    },
  }
}

function annotationEntries(m: BurndownModel, annotations: Annotation[]): Record<string, AnnotationOptions> {
  const entries: Record<string, AnnotationOptions> = {}
  if (m.tolerance !== null) {
    entries.tolerance = {
      type: 'line',
      yMin: m.tolerance,
      yMax: m.tolerance,
      borderColor: GREEN,
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

  for (const { index, date, offset } of stackAnnotationLabels(items, m.axis)) {
    const annotation = annotations[index]
    const { value } = items[index]
    const colour = effectiveType(annotation) === 'risk' ? RED : BLUE
    const hSign = horizontalPushSign(m.axis.indexOf(date), m.axis.length)
    entries[`note-${index}`] = {
      type: 'label',
      xValue: date,
      yValue: value,
      content: annotation.text.split('\n').slice(0, ANNOTATION_LABEL.MAX_LINES),
      drawTime: 'beforeDatasetsDraw', // behind the data lines (§10.5)
      font: { size: 10 },
      textAlign: 'start',
      padding: { top: 5, bottom: 5, left: 7, right: 7 },
      color: '#1f2937',
      backgroundColor: tint(colour, 0.12),
      borderColor: colour,
      borderWidth: 1,
      borderRadius: 4,
      callout: { display: true, borderColor: colour, borderDash: [3, 3], borderWidth: 1 },
      xAdjust: (ctx: PartialEventContext) => hSign * PUSH_RATIO * ctx.chart.width,
      // Offsets are workload units (ledger #11, unclamped), converted to pixels through the y scale.
      yAdjust: (ctx: PartialEventContext) => workloadOffsetToPixels(ctx.chart, value, offset),
    }
  }
  return entries
}

function workloadOffsetToPixels(chart: Chart, value: number, offset: number): number {
  const y = chart.scales?.y
  if (!y) return 0
  const pixels = Math.abs(y.getPixelForValue(value + offset) - y.getPixelForValue(value))
  // Upper half of the range → upwards (negative pixel y), lower half → downwards.
  return verticalPushSign(value, y.min, y.max) === 1 ? -pixels : pixels
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
