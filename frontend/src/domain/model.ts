// Wiring of §7–§9 for one displayed iteration: the single entry point the chart components consume.
import type { IterationReport, SeriesPoint } from '../api/types'
import {
  buildAxis,
  burnup,
  type BurnupModel,
  committedTotal,
  completeSeries,
  idealSeries,
  remainingSeries,
  toleranceLevel,
  type Value,
} from './curve'
import type { IsoDate } from './dates'
import { type DeviationLabel, deviationLabels, reservesGutter } from './deviationLabels'
import { type ForecastSeries, type ForecastStrategy, forecastHistory, historySeries, selectForecast } from './forecast'
import { isLive } from './state'

/** A date-sorted copy (stable); the input is left untouched. */
const sortedByDate = (series: SeriesPoint[]): SeriesPoint[] =>
  [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

export interface BurndownModel {
  /** completeSeries(iteration, today) — same reference as report.series when nothing was added. */
  series: SeriesPoint[]
  /** buildAxis(series, iteration.dueDate). */
  axis: IsoDate[]
  /** true unless state === 'closed' (unknown = live). */
  live: boolean
  /** axis.indexOf(today) for a live iteration (accent-coloured dot, §7.4); −1 when closed or absent. */
  todayIndex: number
  remaining: Value[]
  ideal: Value[]
  forecast: ForecastSeries
  forecastStrategy: ForecastStrategy
  committedTotal: number
  /** toleranceLevel(committedTotal): null ⇒ no tolerance line. */
  tolerance: number | null
  /** deviationLabels({ committedTotal, state, forecast }). */
  labels: DeviationLabel[]
  /** reservesGutter(labels). */
  reserveGutter: boolean
}

export interface BurndownModelInput {
  /** The displayed iteration. */
  iteration: IterationReport
  /** The group's whole newest-first report list (the one per-group read, §5.2); source of the history. */
  iterations: IterationReport[]
  /** UTC calendar day (inject `todayUtc()`). */
  today: IsoDate
}

/**
 * Pipeline: series = completeSeries; axis = buildAxis; history =
 * historySeries(forecastHistory(iterations, iteration)); forecast = selectForecast with the series sorted
 * ascending by date (a copy — `series` itself is returned untouched); committedTotal(iteration.report,
 * sortedSeries); labels; gutter.
 */
export function buildBurndownModel(input: BurndownModelInput): BurndownModel {
  const { iteration, iterations, today } = input
  const series = completeSeries(iteration, today)
  const sorted = sortedByDate(series)
  const axis = buildAxis(series, iteration.dueDate)
  const live = isLive(iteration.state)
  const history = historySeries(forecastHistory(iterations, iteration))
  const { strategy, values } = selectForecast({ state: iteration.state, series: sorted, axis, history, today })
  const committed = committedTotal(iteration.report, sorted)
  const labels = deviationLabels({ committedTotal: committed, state: iteration.state, forecast: values })
  return {
    series,
    axis,
    live,
    todayIndex: live ? axis.indexOf(today) : -1,
    remaining: remainingSeries(series, axis),
    ideal: idealSeries(series, axis),
    forecast: values,
    forecastStrategy: strategy,
    committedTotal: committed,
    tolerance: toleranceLevel(committed),
    labels,
    reserveGutter: reservesGutter(labels),
  }
}

/**
 * Amendment B: the burnup on the burndown's axis and forecast (same input), so both tabs tell the same story:
 * burnup(sorted burndown series, axis, forecast, todayIndex, dueDate).
 */
export function buildBurnupModel(input: BurndownModelInput): BurnupModel {
  const down = buildBurndownModel(input)
  return burnup(sortedByDate(down.series), down.axis, down.forecast, down.todayIndex, input.iteration.dueDate)
}
