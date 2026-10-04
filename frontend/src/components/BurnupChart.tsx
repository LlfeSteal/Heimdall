// Burnup view (Amendment B, modelled on the GitLab / Jira burnup charts): Completed, real Total scope with the
// remaining work shaded between them, a rising guideline, and the burndown forecast mirrored from today's
// Completed point up to the Total line (projected completion, or the work still open on the due date).
// No tolerance line, no gutter; annotations are dots in their type colour.
import type { ChartData, ChartOptions, ScriptableLineSegmentContext, TooltipItem } from 'chart.js'
import type { AnnotationOptions } from 'chartjs-plugin-annotation'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import type { IterationReport } from '../api/types'
import { type Annotation, annotationsOnDate, effectiveType } from '../annotations/model'
import type { BurnupModel } from '../domain/curve'
import { forecastCaption, progressLines } from '../domain/burnupReading'
import { todayUtc } from '../domain/dates'
import { formatPoints } from '../domain/format'
import { buildBurnupModel } from '../domain/model'
import { isClosed } from '../domain/state'
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
  /** The group's whole report list (forecast history, §6) — the burnup mirrors the burndown forecast. */
  reports: IterationReport[]
  annotations: Annotation[]
  onPointClick: (date: string) => void
}

export function BurnupChart({ iteration, reports, annotations, onPointClick }: Props) {
  const today = todayUtc()
  const theme = useChartTheme()
  const model = useMemo(
    () => buildBurnupModel({ iteration, iterations: reports, today }),
    [iteration, reports, today],
  )
  const caption = forecastCaption(model, isClosed(iteration.state))

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
    <>
      {caption && (
        <p className="chart-caption" data-testid="burnup-forecast">
          <span className="dot" data-series="forecast" aria-hidden="true" />
          {caption}
        </p>
      )}
      <div className="chart-canvas">
        <Line
          data={data}
          options={options}
          role="img"
          aria-label={caption ? `${S.burnupTitle}. ${caption}` : S.burnupTitle}
        />
      </div>
    </>
  )
}

function burnupData(m: BurnupModel, t: ChartTheme): ChartData<'line', (number | null)[], string> {
  const dotColours = m.axis.map((_, i) => (i === m.todayIndex ? t.today : t.delivered))
  return {
    labels: m.axis,
    datasets: [
      {
        label: S.legendCompleted,
        data: m.completed,
        borderColor: t.delivered,
        backgroundColor: tint(t.delivered, 0.14),
        // Today's dot on a live iteration is red, as on the burndown (STYLEGUIDE.md §1: red means today).
        pointBackgroundColor: dotColours,
        pointBorderColor: dotColours,
        fill: 'origin',
        pointStyle: 'circle',
        cubicInterpolationMode: 'monotone', // a gentle curve that never overshoots a recorded value
        pointRadius: 3,
        pointHoverRadius: 5,
      },
      {
        label: S.legendTotalScope,
        data: m.totalScope,
        borderColor: t.totalScope,
        // The remaining work: the band between Total scope and Completed, in the burndown's Remaining colour.
        backgroundColor: tint(t.remaining, 0.1),
        fill: { target: 0, above: tint(t.remaining, 0.1), below: 'transparent' },
        borderWidth: 2,
        // Solid over the recorded days, dashed where the scope is only carried forward.
        segment: {
          borderDash: (ctx: ScriptableLineSegmentContext) =>
            m.scopeProjectedFrom >= 0 && ctx.p0DataIndex >= m.scopeProjectedFrom ? SCOPE_DASH : undefined,
        },
        pointStyle: 'line', // line swatch in the legend
        pointRadius: 0,
        pointHoverRadius: 0,
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
  const axis = axisStyle(t)
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      // Half a day of margin at both ends, so the due-date bracket and the edge points are never clipped.
      x: { ...axis, offset: true, grid: { ...axis.grid, offset: false } },
      y: {
        ...axis,
        beginAtZero: true,
        grace: '8%', // headroom for the labels sitting on the Total line
        title: { display: true, text: S.burnupYAxis, color: t.textSecondary, font: { family: t.font, size: 12 } },
      },
    },
    onClick: pointClickHandler(m.axis, m.completed, onPointClick),
    plugins: {
      title: titleStyle(t, S.burnupTitle, false), // shown as the HTML heading of the chart head
      legend: legendStyle(t),
      tooltip: {
        ...tooltipStyle(t),
        callbacks: {
          label: (item: TooltipItem<'line'>) => `${item.dataset.label}: ${formatPoints(item.parsed.y ?? 0)}`,
          // GitLab-style reading of the hovered day: what is left between scope and done, and the share done.
          afterBody: (items: TooltipItem<'line'>[]) => (items.length ? progressLines(m, items[0].dataIndex) : []),
          // Every annotation text of the hovered date, one per line (as on the burndown).
          footer: (items: TooltipItem<'line'>[]) =>
            items.length ? annotationsOnDate(annotations, m.axis[items[0].dataIndex]).map((a) => a.text) : [],
        },
      },
      // Not clipped to the plot: the forecast labels may reach into the title / axis margins on small screens.
      annotation: { clip: false, annotations: { ...annotationMarkers(m, annotations, t), ...forecastMarkers(m, t) } },
    },
  }
}

/**
 * One marker per distinct annotated date on the axis, at the Completed value (no text), in the type colour:
 * red when any annotation of that date is a Risk, blue otherwise.
 */
function annotationMarkers(m: BurnupModel, annotations: Annotation[], t: ChartTheme) {
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
  return markers
}

/** Where the forecast meets the Total line (projected completion), or the gap still open on the due date. */
function forecastMarkers(m: BurnupModel, t: ChartTheme) {
  const entries: Record<string, AnnotationOptions> = {}
  const label = (xValue: string, yValue: number, content: string, leftOfPoint: boolean, above: boolean): AnnotationOptions => ({
    type: 'label',
    xValue,
    yValue,
    content,
    font: { family: t.font, size: 11, weight: 600 },
    color: t.forecast,
    backgroundColor: t.card,
    borderColor: t.forecast,
    borderWidth: 1,
    borderRadius: 6,
    padding: { top: 3, bottom: 3, left: 6, right: 6 },
    // The box grows away from the plot edge it is close to; `above` lifts it over its point.
    position: { x: leftOfPoint ? 'end' : 'start', y: above ? 'end' : 'center' },
    xAdjust: above ? 0 : leftOfPoint ? -8 : 8,
    yAdjust: above ? -10 : 0,
  })

  if (m.projectedDone !== null) {
    const { index, date } = m.projectedDone
    const y = m.forecast[index] ?? 0
    entries['projected-done'] = {
      type: 'point',
      xValue: date,
      yValue: y,
      radius: 5,
      backgroundColor: t.forecast,
      borderColor: t.card,
      borderWidth: 1.5,
    }
    entries['projected-done-label'] = label(date, y, S.burnupDoneLabel(date), index > (m.axis.length - 1) / 2, true)
  } else if (m.openAtDue !== null && m.dueDate !== null) {
    // openAtDue is only set when the axis ends on the due date and the forecast has a value there.
    const reached = m.forecast[m.axis.length - 1] ?? 0
    const top = reached + m.openAtDue
    entries['open-at-due'] = {
      type: 'line',
      xMin: m.dueDate,
      xMax: m.dueDate,
      yMin: reached,
      yMax: top,
      borderColor: t.forecast,
      borderWidth: 2,
    }
    const middle = (reached + top) / 2
    entries['open-at-due-label'] = label(m.dueDate, middle, S.burnupOpenLabel(formatPoints(m.openAtDue)), true, false)
  }

  return entries
}
