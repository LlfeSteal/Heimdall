// Burnup view (SPEC §7.6): deliberately simpler — no tolerance line, no gutter, annotations as amber dots.
import type { ChartData, ChartOptions } from 'chart.js'
import type { AnnotationOptions } from 'chartjs-plugin-annotation'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import type { IterationReport } from '../api/types'
import type { Annotation } from '../annotations/model'
import type { BurnupModel } from '../domain/curve'
import { todayUtc } from '../domain/dates'
import { buildBurnupModel } from '../domain/model'
import { S } from '../strings'
import { ACCENT, AMBER, DASH, GREEN, GREY, LEGEND, NEUTRAL, pointClickHandler, tint } from './chartSetup'

interface Props {
  iteration: IterationReport
  annotations: Annotation[]
  onPointClick: (date: string) => void
}

export function BurnupChart({ iteration, annotations, onPointClick }: Props) {
  const today = todayUtc()
  const model = useMemo(() => buildBurnupModel(iteration, today), [iteration, today])

  // Latest click handler, read only when Chart.js reports a click (keeps the options stable).
  const clickRef = useRef(onPointClick)
  useLayoutEffect(() => {
    clickRef.current = onPointClick
  })

  const data = useMemo(() => burnupData(model), [model])
  const options = useMemo(
    // oxlint-disable-next-line react/refs -- read only when Chart.js reports a click
    () => burnupOptions(model, annotations, (date) => clickRef.current(date)),
    [model, annotations],
  )

  return (
    <div className="chart-canvas">
      <Line data={data} options={options} role="img" aria-label={S.burnupTitle} />
    </div>
  )
}

function burnupData(m: BurnupModel): ChartData<'line', (number | null)[], string> {
  return {
    labels: m.axis,
    datasets: [
      {
        label: S.legendCompleted,
        data: m.completed,
        borderColor: GREEN,
        backgroundColor: tint(GREEN, 0.14),
        pointBackgroundColor: GREEN,
        fill: 'origin',
        pointStyle: 'circle',
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
      {
        label: S.legendTotalScope,
        data: m.totalScope,
        borderColor: NEUTRAL,
        backgroundColor: NEUTRAL,
        borderDash: DASH,
        borderWidth: 1.5,
        pointStyle: 'line', // dashed swatch in the legend
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
      },
      {
        label: S.legendIdeal,
        data: m.ideal,
        borderColor: GREY,
        backgroundColor: GREY,
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
        borderColor: ACCENT,
        backgroundColor: ACCENT,
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
  onPointClick: (date: string) => void,
): ChartOptions<'line'> {
  // One amber marker per distinct annotated date on the axis, at the Completed value (no text, §7.6).
  const markers: Record<string, AnnotationOptions> = {}
  for (const date of new Set(annotations.map((a) => a.date))) {
    const i = m.axis.indexOf(date)
    if (i < 0) continue
    markers[`marker-${i}`] = {
      type: 'point',
      xValue: date,
      yValue: m.completed[i] ?? 0,
      backgroundColor: AMBER,
      borderColor: AMBER,
      radius: 5,
    }
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: { y: { beginAtZero: true } },
    onClick: pointClickHandler(m.axis, m.completed, onPointClick),
    plugins: {
      title: { display: true, text: S.burnupTitle },
      legend: LEGEND,
      annotation: { annotations: markers },
    },
  }
}
