// Burnup view (SPEC §7.6): deliberately simpler — no tolerance line, no gutter, annotations as dots in their type colour.
import type { ChartData, ChartOptions } from 'chart.js'
import type { AnnotationOptions } from 'chartjs-plugin-annotation'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import type { IterationReport } from '../api/types'
import { type Annotation, effectiveType } from '../annotations/model'
import type { BurnupModel } from '../domain/curve'
import { todayUtc } from '../domain/dates'
import { buildBurnupModel } from '../domain/model'
import { S } from '../strings'
import {
  type ChartTheme,
  DASH,
  SCOPE_DASH,
  axisStyle,
  legendStyle,
  pointClickHandler,
  tint,
  titleStyle,
  tooltipStyle,
  useChartTheme,
} from './chartSetup'

interface Props {
  iteration: IterationReport
  annotations: Annotation[]
  onPointClick: (date: string) => void
}

export function BurnupChart({ iteration, annotations, onPointClick }: Props) {
  const today = todayUtc()
  const theme = useChartTheme()
  const model = useMemo(() => buildBurnupModel(iteration, today), [iteration, today])

  // Latest click handler, read only when Chart.js reports a click (keeps the options stable).
  const clickRef = useRef(onPointClick)
  useLayoutEffect(() => {
    clickRef.current = onPointClick
  })

  const data = useMemo(() => burnupData(model, theme), [model, theme])
  const options = useMemo(
    // oxlint-disable-next-line react/refs -- read only when Chart.js reports a click
    () => burnupOptions(model, annotations, theme, (date) => clickRef.current(date)),
    [model, annotations, theme],
  )

  return (
    <div className="chart-canvas">
      <Line data={data} options={options} role="img" aria-label={S.burnupTitle} />
    </div>
  )
}

function burnupData(m: BurnupModel, t: ChartTheme): ChartData<'line', (number | null)[], string> {
  return {
    labels: m.axis,
    datasets: [
      {
        label: S.legendCompleted,
        data: m.completed,
        borderColor: t.delivered,
        backgroundColor: tint(t.delivered, 0.14),
        pointBackgroundColor: t.delivered,
        fill: 'origin',
        pointStyle: 'circle',
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
      {
        label: S.legendTotalScope,
        data: m.totalScope,
        borderColor: t.totalScope,
        backgroundColor: t.totalScope,
        borderDash: SCOPE_DASH,
        borderWidth: 1.5,
        pointStyle: 'line', // dashed swatch in the legend
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
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

function burnupOptions(
  m: BurnupModel,
  annotations: Annotation[],
  t: ChartTheme,
  onPointClick: (date: string) => void,
): ChartOptions<'line'> {
  // One marker per distinct annotated date on the axis, at the Completed value (no text, §7.6), in the type
  // colour: red when any annotation of that date is a Risk, blue otherwise.
  const markers: Record<string, AnnotationOptions> = {}
  for (const date of new Set(annotations.map((a) => a.date))) {
    const i = m.axis.indexOf(date)
    if (i < 0) continue
    const risk = annotations.some((a) => a.date === date && effectiveType(a) === 'risk')
    const colour = risk ? t.risk : t.info
    markers[`marker-${i}`] = {
      type: 'point',
      xValue: date,
      yValue: m.completed[i] ?? 0,
      backgroundColor: colour,
      borderColor: t.card,
      borderWidth: 1.5,
      radius: 5,
    }
  }
  const axis = axisStyle(t)
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: { x: axis, y: { ...axis, beginAtZero: true } },
    onClick: pointClickHandler(m.axis, m.completed, onPointClick),
    plugins: {
      title: titleStyle(t, S.burnupTitle),
      legend: legendStyle(t),
      tooltip: tooltipStyle(t),
      annotation: { annotations: markers },
    },
  }
}
