// Building the curve: completeness repairs, axis, burndown series, tolerance, burnup (SPEC §7).
import type { IterationState, Report, SeriesPoint } from '../api/types'
import { addDays, daysBetween, type IsoDate } from './dates'
import { isClosed } from './state'

/** A chart value at one axis position; `null` = "nothing here" (a gap; never interpolated). */
export type Value = number | null

/** The subset of an `IterationReport` the curve functions need. */
export interface CurveIteration {
  state: IterationState
  dueDate: IsoDate | null
  report: Report | null
}

// ---------------------------------------------------------------------------------------------------
// §7.2 Completing an incomplete curve
// ---------------------------------------------------------------------------------------------------

/** A repair point carrying the report totals; remaining is the in-progress total, NOT committed − delivered. */
function totalsPoint(date: IsoDate, report: Report): SeriesPoint {
  return {
    date,
    committed: report.totals.committed.weight,
    delivered: report.totals.delivered.weight,
    remaining: report.totals.inProgress.weight,
  }
}

/** Latest date of a non-empty series (ISO dates compare as text). */
function latestDate(series: SeriesPoint[]): IsoDate {
  return series.reduce((latest, p) => (p.date > latest ? p.date : latest), series[0].date)
}

/** First point per date (later duplicates are ignored, as in "the point with that date"). */
function pointsByDate(series: SeriesPoint[]): Map<IsoDate, SeriesPoint> {
  const byDate = new Map<IsoDate, SeriesPoint>()
  for (const p of series) if (!byDate.has(p.date)) byDate.set(p.date, p)
  return byDate
}

/** Distinct series dates, ascending. */
function distinctDates(series: SeriesPoint[]): IsoDate[] {
  return [...new Set(series.map((p) => p.date))].sort()
}

/**
 * §7.2 live repair. If the iteration is NOT closed (unknown state counts as live), it has a report, and
 * no point of `series` is dated `today`: return a NEW array = `series` + one point appended at the END
 * (not sorted into place — the axis sort handles position) with
 *   committed = report.totals.committed.weight,
 *   delivered = report.totals.delivered.weight,
 *   remaining = report.totals.inProgress.weight   (NOT committed − delivered).
 * Otherwise return `series` itself (same reference). Never mutates the input.
 * `today` must be the UTC calendar day (see `todayUtc`), injected by the caller.
 */
export function withTodayPoint(series: SeriesPoint[], iteration: CurveIteration, today: IsoDate): SeriesPoint[] {
  const { state, report } = iteration
  if (isClosed(state) || report === null || series.some((p) => p.date === today)) return series
  return [...series, totalsPoint(today, report)]
}

/**
 * §7.2 closed repair. Only for `state === 'closed'`. Returns `series` itself (same reference — callers
 * rely on identity) when: not closed, no points, no due date, no report, or the LAST point's date
 * (`series[series.length − 1].date`) is already on or after the due date. Otherwise returns a NEW array
 * with one point dated `dueDate` appended, carrying the report totals exactly as `withTodayPoint`.
 */
export function withDueDatePoint(series: SeriesPoint[], iteration: CurveIteration): SeriesPoint[] {
  const { state, dueDate, report } = iteration
  if (!isClosed(state) || series.length === 0 || dueDate === null || report === null) return series
  if (series[series.length - 1].date >= dueDate) return series
  return [...series, totalsPoint(dueDate, report)]
}

/**
 * Applies the repair relevant to the iteration's state to `iteration.report?.series ?? []`:
 * closed → `withDueDatePoint`, otherwise → `withTodayPoint`. When nothing is added, returns the
 * report's own `series` array (same reference).
 */
export function completeSeries(iteration: CurveIteration, today: IsoDate): SeriesPoint[] {
  const series = iteration.report?.series ?? []
  return isClosed(iteration.state) ? withDueDatePoint(series, iteration) : withTodayPoint(series, iteration, today)
}

// ---------------------------------------------------------------------------------------------------
// §7.3 Horizontal axis
// ---------------------------------------------------------------------------------------------------

/**
 * §7.3. axis = the set of distinct dates present in `series`; if `dueDate` is given, walk forward one
 * calendar day at a time from the LAST known point (the latest date in the series) adding every date up
 * to and including `dueDate`, then make sure `dueDate` itself is present (it is added even when it falls
 * before the last point). Finally sort ascending (ISO text order). Only the trailing gap is filled: a
 * hole before the first point and interior holes are NOT filled. Weekends are ordinary days.
 */
export function buildAxis(series: SeriesPoint[], dueDate: IsoDate | null): IsoDate[] {
  const dates = new Set(series.map((p) => p.date))
  if (dueDate !== null) {
    if (series.length > 0) {
      for (let d = addDays(latestDate(series), 1); d <= dueDate; d = addDays(d, 1)) dates.add(d)
    }
    dates.add(dueDate)
  }
  return [...dates].sort()
}

export interface AxisMetrics {
  /** Position on `axis` of the first date that has a point in `series`; −1 when none does. */
  firstIndex: number
  /** `max(lastAxisPosition − firstIndex, 1)` where lastAxisPosition = axis.length − 1. */
  totalDays: number
}

/** §7.3 derived quantities used by the ideal lines. */
export function axisMetrics(axis: IsoDate[], series: SeriesPoint[]): AxisMetrics {
  const dates = new Set(series.map((p) => p.date))
  const firstIndex = axis.findIndex((d) => dates.has(d))
  return { firstIndex, totalDays: Math.max(axis.length - 1 - firstIndex, 1) }
}

// ---------------------------------------------------------------------------------------------------
// §7.4 Burndown series
// ---------------------------------------------------------------------------------------------------

/**
 * §7.4 Remaining: for each axis position, the `remaining` of the point with that date (first match);
 * `null` where there is no point (the line BREAKS there — no interpolation). Negative values are kept
 * as-is (§7.1, ledger #7).
 */
export function remainingSeries(series: SeriesPoint[], axis: IsoDate[]): Value[] {
  const byDate = pointsByDate(series)
  return axis.map((d) => byDate.get(d)?.remaining ?? null)
}

/**
 * §7.4 Ideal: `null` before firstIndex (and everywhere when firstIndex = −1); otherwise
 * `max(0, firstRemaining − (firstRemaining / totalDays) × (position − firstIndex))`, where
 * firstRemaining = remaining of the point at axis[firstIndex].
 * MUST be exactly 0 (not 3.5e-15) at the last axis position when last > firstIndex — compute it in an
 * algebraically equivalent, exact-at-the-end form, e.g. `firstRemaining × (1 − (position − firstIndex) / totalDays)`.
 */
export function idealSeries(series: SeriesPoint[], axis: IsoDate[]): Value[] {
  const { firstIndex, totalDays } = axisMetrics(axis, series)
  if (firstIndex < 0) return axis.map(() => null)
  const firstRemaining = pointsByDate(series).get(axis[firstIndex])!.remaining
  // r × (1 − k/n) equals r − (r/n) × k but is exactly 0 at k = n; Math.max(0, …) also turns −0 into 0.
  return axis.map((_, pos) =>
    pos < firstIndex ? null : Math.max(0, firstRemaining * (1 - (pos - firstIndex) / totalDays)),
  )
}

// ---------------------------------------------------------------------------------------------------
// §7.5 Tolerance
// ---------------------------------------------------------------------------------------------------

/** Tolerance band ratio (§2.3): 10 % of committed workload. */
export const TOLERANCE_RATIO = 0.1

/**
 * §7.5 committedTotal = report.totals.committed.weight when there is a report; otherwise the committed
 * workload of the first point of `series` (`series[0]`); otherwise 0.
 */
export function committedTotal(report: Report | null, series: SeriesPoint[]): number {
  if (report !== null) return report.totals.committed.weight
  return series[0]?.committed ?? 0
}

/** §7.5 tolerance = committedTotal × 10 %; `null` (no line, no labels) when committedTotal ≤ 0. */
export function toleranceLevel(committedTotal: number): number | null {
  return committedTotal > 0 ? committedTotal * TOLERANCE_RATIO : null
}

// ---------------------------------------------------------------------------------------------------
// §7.6 Burnup (KNOWN BEHAVIOUR formulas reproduced on purpose, ledger #8)
// ---------------------------------------------------------------------------------------------------

/** §7.6 the burnup axis extends at most this many days after the last point. */
export const BURNUP_EXTENSION_DAYS = 7

/**
 * §7.6 burnup axis = distinct series dates sorted ascending, plus each of the 7 calendar days after the
 * last (latest) point that is on or before `dueDate`. No due date → no extension.
 */
export function buildBurnupAxis(series: SeriesPoint[], dueDate: IsoDate | null): IsoDate[] {
  const axis = distinctDates(series)
  if (dueDate === null || series.length === 0) return axis
  const last = latestDate(series)
  for (let k = 1; k <= BURNUP_EXTENSION_DAYS; k++) {
    const d = addDays(last, k)
    if (d <= dueDate) axis.push(d)
  }
  return axis
}

export interface BurnupModel {
  axis: IsoDate[]
  /** Largest committed workload of any point (0 for an empty series). */
  maxScope: number
  /** delivered at that date; null where there is no point. */
  completed: Value[]
  /** constant maxScope at every axis position. */
  totalScope: number[]
  /**
   * KNOWN BEHAVIOUR (descends): null before firstIndex, and null everywhere when the span
   * (lastAxisPosition − firstIndex) is 0; otherwise the §7.4 burndown ideal formula on the burnup axis
   * (firstRemaining = remaining of the first point).
   */
  ideal: Value[]
  /**
   * KNOWN BEHAVIOUR (saturates): null on or before the last recorded date; afterwards
   * `min(maxScope, lastDelivered + slope × daysAfterLast)` with slope = FIRST point's committed workload
   * PER DAY and daysAfterLast in calendar days. (The `maxScope / daysRemaining` fallback for "no first
   * point" is unreachable: no points ⇒ empty axis.)
   */
  forecast: Value[]
}

/** §7.6 all burnup series for an (already repaired) series. Pure; does not mutate input. */
export function burnup(series: SeriesPoint[], dueDate: IsoDate | null): BurnupModel {
  const axis = buildBurnupAxis(series, dueDate)
  if (series.length === 0) return { axis, maxScope: 0, completed: [], totalScope: [], ideal: [], forecast: [] }

  const byDate = pointsByDate(series)
  const maxScope = Math.max(...series.map((p) => p.committed))
  const { firstIndex } = axisMetrics(axis, series)
  const span = axis.length - 1 - firstIndex
  const lastDate = latestDate(series)
  const lastDelivered = byDate.get(lastDate)!.delivered
  const slope = series[0].committed // KNOWN BEHAVIOUR: a whole committed workload per day

  return {
    axis,
    maxScope,
    completed: axis.map((d) => byDate.get(d)?.delivered ?? null),
    totalScope: axis.map(() => maxScope),
    ideal: firstIndex < 0 || span <= 0 ? axis.map(() => null) : idealSeries(series, axis),
    forecast: axis.map((d) =>
      d <= lastDate ? null : Math.min(maxScope, lastDelivered + slope * daysBetween(lastDate, d)),
    ),
  }
}
