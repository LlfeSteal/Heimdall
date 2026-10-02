// Forecasting (SPEC §8) and forecast-history selection (§6).
import type { IterationReport, IterationState, SeriesPoint } from '../api/types'
import type { Value } from './curve'
import { daysBetween, type IsoDate } from './dates'
import { isClosed } from './state'
import { median } from './stats'

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
const isValidIndex = (i: number): boolean => Number.isInteger(i) && i >= 0

/** Forecast trend window (§2.3): last 5 points. */
export const TREND_WINDOW = 5
/** Forecast history window / historical sample cap (§2.3, §6). */
export const HISTORY_MAX = 4
/** Canonical shape grid (§2.3): 21 points, f = 0, 0.05, …, 1. */
export const SHAPE_GRID_POINTS = 21
/** §8.3: shapeToday at or below this ⇒ the shape had already collapsed ⇒ not usable. */
export const SHAPE_COLLAPSE_EPSILON = 0.000000001

/**
 * "Not usable" — the shape strategy DECLINES. Distinct from every array, in particular from `[]`
 * ("usable but empty", returned by the velocity strategy). Compare with `=== NOT_USABLE`.
 */
export const NOT_USABLE: unique symbol = Symbol('forecast-not-usable')
export type NotUsable = typeof NOT_USABLE

/** Forecast values per axis position; `null` = no value. Length endIndex+1, or `[]` (empty result). */
export type ForecastSeries = Value[]

/** One point of a unit-free shape: f = fraction of time elapsed (0…1), y = fraction still open (≥ 0). */
export interface ShapePoint {
  f: number
  y: number
}
export type Shape = ShapePoint[]

/**
 * History passed to the forecast strategies: one series per past iteration, in the order given by
 * `forecastHistory` (newest first). Raw `report.series` — the §7.2 repairs are NOT applied to history.
 */
export type History = SeriesPoint[][]

/**
 * §8.2 dailyDirection: take the last ≤ `window` points of `series` (array order); fewer than 2 → 0;
 * otherwise sum of consecutive changes of `remaining` (point-to-point, not per calendar day) ÷ (count − 1),
 * clamped with `min(0, …)` — a rising curve is flat (0), never positive.
 */
export function dailyDirection(series: SeriesPoint[], window: number = TREND_WINDOW): number {
  const points = series.slice(Math.max(0, series.length - window))
  if (points.length < 2) return 0
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += points[i].remaining - points[i - 1].remaining
  return Math.min(0, sum / (points.length - 1))
}

/**
 * §8.3 shapeOf: keep points with committed ≠ 0; fewer than 2 kept → null ("no shape").
 * start/end = dates of the FIRST / LAST point of the UNFILTERED series (array order); end ≤ start → null.
 * For each kept point: f = clamp(daysBetween(start, date) / daysBetween(start, end), 0, 1),
 * y = max(0, remaining / committed of THAT point). Sorted by f ascending.
 */
export function shapeOf(series: SeriesPoint[]): Shape | null {
  const kept = series.filter((p) => p.committed !== 0)
  if (kept.length < 2) return null
  const start = series[0].date
  const span = daysBetween(start, series[series.length - 1].date)
  if (span <= 0) return null
  return kept
    .map((p) => ({ f: clamp(daysBetween(start, p.date) / span, 0, 1), y: Math.max(0, p.remaining / p.committed) }))
    .sort((a, b) => a.f - b.f)
}

/**
 * §8.3 sample: piecewise-linear, flat beyond both ends. Empty → 0; f ≤ first.f → first.y;
 * f ≥ last.f → last.y; otherwise interpolate between the bracketing pair; a zero-width segment
 * contributes no slope (never divide by zero, never NaN).
 */
export function sample(shape: Shape, f: number): number {
  if (shape.length === 0) return 0
  const first = shape[0]
  const last = shape[shape.length - 1]
  if (f <= first.f) return first.y
  if (f >= last.f) return last.y
  // Bracket a.f ≤ f < b.f: b.f > a.f strictly, so a zero-width segment is never divided by.
  for (let i = 1; i < shape.length; i++) {
    const b = shape[i]
    if (f < b.f) {
      const a = shape[i - 1]
      return a.y + ((b.y - a.y) * (f - a.f)) / (b.f - a.f)
    }
  }
  return last.y
}

/**
 * §8.3 canonicalShape: take the FIRST ≤ maxIterations entries of `history`, THEN shape them and keep the
 * usable ones (so an unusable entry still consumes one of the slots); none → null. For i = 0…20:
 * value_i = median over shapes of sample(shape, i/20); then one forward sweep replacing each value with
 * the running minimum, floored at 0. Returns the 21 points `{ f: i/20, y: value_i }`.
 */
export function canonicalShape(history: History, maxIterations: number = HISTORY_MAX): Shape | null {
  const shapes = history
    .slice(0, maxIterations)
    .map(shapeOf)
    .filter((shape): shape is Shape => shape !== null)
  if (shapes.length === 0) return null
  let runningMin = Infinity
  return Array.from({ length: SHAPE_GRID_POINTS }, (_, i) => {
    const f = i / (SHAPE_GRID_POINTS - 1)
    runningMin = Math.min(runningMin, median(shapes.map((shape) => sample(shape, f))))
    return { f, y: Math.max(0, runningMin) }
  })
}

/**
 * §8.3 shapeForecast. NOT_USABLE when: todayIndex is not a non-negative integer, todayIndex ≥ endIndex,
 * axis[todayIndex] is undefined, or no point of `series` has date axis[todayIndex].
 * Otherwise result = Array(endIndex+1).fill(null); result[todayIndex] = today.remaining;
 * if today.remaining ≤ 0 → every position after todayIndex = 0, return (BEFORE looking at history).
 * shape = canonicalShape(history, maxIterations) — null → NOT_USABLE.
 * start = series[0].date, end = axis[endIndex] (undefined or end ≤ start → NOT_USABLE).
 * fractionOf(d) = clamp(daysBetween(start, d) / daysBetween(start, end), 0, 1).
 * shapeToday = sample(shape, fractionOf(axis[todayIndex])); ≤ SHAPE_COLLAPSE_EPSILON → NOT_USABLE.
 * For i in (todayIndex, endIndex]: result[i] = clamp(today.remaining × sample(shape, fractionOf(axis[i])) / shapeToday, 0, today.remaining).
 */
export function shapeForecast(
  series: SeriesPoint[],
  history: History,
  axis: IsoDate[],
  todayIndex: number,
  endIndex: number,
  maxIterations: number = HISTORY_MAX,
): ForecastSeries | NotUsable {
  if (!isValidIndex(todayIndex) || todayIndex >= endIndex || axis[todayIndex] === undefined) return NOT_USABLE
  const today = series.find((p) => p.date === axis[todayIndex])
  if (today === undefined) return NOT_USABLE

  const result: ForecastSeries = Array(endIndex + 1).fill(null)
  result[todayIndex] = today.remaining
  if (today.remaining <= 0) return result.fill(0, todayIndex + 1)

  const shape = canonicalShape(history, maxIterations)
  if (shape === null) return NOT_USABLE
  const start = series[0].date
  const end = axis[endIndex]
  if (end === undefined) return NOT_USABLE
  const span = daysBetween(start, end)
  if (span <= 0) return NOT_USABLE
  const fractionOf = (date: IsoDate) => clamp(daysBetween(start, date) / span, 0, 1)

  const shapeToday = sample(shape, fractionOf(axis[todayIndex]))
  if (shapeToday <= SHAPE_COLLAPSE_EPSILON) return NOT_USABLE
  for (let i = todayIndex + 1; i <= endIndex; i++) {
    result[i] = clamp((today.remaining * sample(shape, fractionOf(axis[i]))) / shapeToday, 0, today.remaining)
  }
  return result
}

/**
 * §8.4 one history iteration's daily delivery rate:
 * max(0, (lastDelivered − firstDelivered) / (numberOfPoints − 1)) using array order.
 * Fewer than 2 points → null (no rate; avoids 0/0). Callers keep only strictly positive rates.
 */
export function historicalRate(series: SeriesPoint[]): number | null {
  if (series.length < 2) return null
  const first = series[0]
  const last = series[series.length - 1]
  return Math.max(0, (last.delivered - first.delivered) / (series.length - 1))
}

/**
 * §8.4 velocityForecast (fallback). Returns `[]` (EMPTY, distinct from NOT_USABLE) when todayIndex is not
 * a non-negative integer or todayIndex ≥ endIndex.
 * result = Array(endIndex+1).fill(null); today = series[todayIndex] (by POSITION in `series`, not by date);
 * if absent → return that all-null array.
 * result[todayIndex] = today.remaining.
 * rates = strictly positive historicalRate of the first ≤ maxIterations history entries;
 * ownRate = max(0, −dailyDirection(series, 5)); if ownRate > 0 append it (the blend);
 * velocity = median(rates) (0 when empty); trend = dailyDirection(series, 5).
 * For i after todayIndex (skip if result[i−1] is null):
 *   velocity > 0 → max(0, today.remaining − velocity × (i − todayIndex)); else max(0, result[i−1] + trend).
 */
export function velocityForecast(
  series: SeriesPoint[],
  history: History,
  todayIndex: number,
  endIndex: number,
  maxIterations: number = HISTORY_MAX,
): ForecastSeries {
  if (!isValidIndex(todayIndex) || todayIndex >= endIndex) return []
  const result: ForecastSeries = Array(endIndex + 1).fill(null)
  const today = series[todayIndex]
  if (today === undefined) return result
  result[todayIndex] = today.remaining

  const rates = history
    .slice(0, maxIterations)
    .map(historicalRate)
    .filter((rate): rate is number => rate !== null && rate > 0)
  const trend = dailyDirection(series, TREND_WINDOW)
  const ownRate = Math.max(0, -trend)
  if (ownRate > 0) rates.push(ownRate) // the blend: one more sample before the median
  const velocity = median(rates)

  for (let i = todayIndex + 1; i <= endIndex; i++) {
    const previous = result[i - 1]
    if (previous === null) continue
    result[i] =
      velocity > 0 ? Math.max(0, today.remaining - velocity * (i - todayIndex)) : Math.max(0, previous + trend)
  }
  return result
}

/**
 * §8.1 closed-iteration projection: no history. last = the last point of `series` (array order; the
 * caller passes a date-sorted series); lastIndex = axis.indexOf(last.date). Result has axis.length
 * entries: null before lastIndex, result[lastIndex] = max(0, last.remaining), and for every later position
 * max(0, last.remaining + dailyDirection(series, 5) × daysBetween(last.date, axis[i])).
 * Empty series or last.date not on the axis → [].
 */
export function closedExtension(series: SeriesPoint[], axis: IsoDate[]): ForecastSeries {
  if (series.length === 0) return []
  const last = series[series.length - 1]
  const lastIndex = axis.indexOf(last.date)
  if (lastIndex < 0) return []
  const direction = dailyDirection(series, TREND_WINDOW)
  return axis.map((date, i) => {
    if (i < lastIndex) return null
    if (i === lastIndex) return Math.max(0, last.remaining)
    return Math.max(0, last.remaining + direction * daysBetween(last.date, date))
  })
}

export type ForecastStrategy = 'closed-extension' | 'shape' | 'velocity' | 'none'

export interface ForecastInput {
  state: IterationState
  /** The completed (§7.2) series, sorted ascending by date. */
  series: SeriesPoint[]
  axis: IsoDate[]
  history: History
  /** UTC calendar day. */
  today: IsoDate
}

export interface ForecastResult {
  strategy: ForecastStrategy
  values: ForecastSeries
}

/**
 * §8.1 strategy selection. closed → 'closed-extension' (`closedExtension`). Otherwise (live, incl. unknown
 * state) with todayIndex = axis.indexOf(today) and endIndex = axis.length − 1: todayIndex < 0 →
 * { 'none', [] }; else shapeForecast — if it returns NOT_USABLE use velocityForecast ('velocity', even when
 * that is `[]`), otherwise 'shape'. A shape result is used even when it is all zeros.
 */
export function selectForecast(input: ForecastInput): ForecastResult {
  const { state, series, axis, history, today } = input
  if (isClosed(state)) return { strategy: 'closed-extension', values: closedExtension(series, axis) }
  const todayIndex = axis.indexOf(today)
  if (todayIndex < 0) return { strategy: 'none', values: [] }
  const endIndex = axis.length - 1
  const shaped = shapeForecast(series, history, axis, todayIndex, endIndex)
  if (shaped === NOT_USABLE) return { strategy: 'velocity', values: velocityForecast(series, history, todayIndex, endIndex) }
  return { strategy: 'shape', values: shaped }
}

/** §8.5 the value of the LAST position that has a (non-null) value; null when there is none. */
export function lastForecastValue(forecast: ForecastSeries): number | null {
  for (let i = forecast.length - 1; i >= 0; i--) {
    const value = forecast[i]
    if (value !== null) return value
  }
  return null
}

/**
 * §8.5 deviationPercent = committedTotal ≤ 0 ? 0 : lastForecastValue / committedTotal × 100.
 * Returns null when the forecast has no value at all (→ no orange label).
 */
export function deviationPercent(forecast: ForecastSeries, committedTotal: number): number | null {
  const last = lastForecastValue(forecast)
  if (last === null) return null
  return committedTotal <= 0 ? 0 : (last / committedTotal) * 100
}

/**
 * §6 forecast history: from the newest-first `iterations` list, the first `max` iterations with
 * state === 'closed' whose startDate is STRICTLY before `selected.startDate`, in list order. The selected
 * iteration (same id) is never included. Iterations with a null startDate, or a selected iteration with a
 * null startDate, yield nothing. Report presence is NOT a filter (a report-less iteration still takes a slot).
 */
export function forecastHistory(
  iterations: IterationReport[],
  selected: IterationReport,
  max: number = HISTORY_MAX,
): IterationReport[] {
  const selectedStart = selected.startDate
  if (selectedStart === null) return []
  return iterations
    .filter(
      (it) => it.id !== selected.id && it.state === 'closed' && it.startDate !== null && it.startDate < selectedStart,
    )
    .slice(0, max)
}

/** Maps history iterations to their raw series (`report?.series ?? []`), order preserved. */
export function historySeries(iterations: IterationReport[]): History {
  return iterations.map((it) => it.report?.series ?? [])
}
