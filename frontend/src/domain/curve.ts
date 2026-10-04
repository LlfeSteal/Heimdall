// Building the curve: completeness repairs, axis, burndown series, tolerance (SPEC §7), burnup (Amendment B).
import type { IterationState, Report, SeriesPoint } from '../api/types'
import { addDays, type IsoDate } from './dates'
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
// Amendment B — Burnup view (replaces §7.6; modelled on the GitLab / Jira burnup charts)
// ---------------------------------------------------------------------------------------------------

export interface BurnupModel {
  /** The burndown axis (`buildAxis`): first point → due date, so both tabs share positions. */
  axis: IsoDate[]
  /** The iteration's due date (null when it has none). */
  dueDate: IsoDate | null
  /** delivered at that date; null where there is no point. */
  completed: Value[]
  /**
   * committed at that date (the real scope, day by day); after the last recorded point, the last point's
   * committed carried forward (projected scope); null on a position with no point before it.
   */
  totalScope: Value[]
  /** Axis position of the last recorded point (the scope line is dashed after it); −1 when there is none. */
  scopeProjectedFrom: number
  /**
   * Guideline: null before firstIndex and everywhere when the span is 0; otherwise rises linearly from 0 at
   * firstIndex to the first point's committed workload, reached exactly on the last axis position.
   */
  ideal: Value[]
  /**
   * The burndown forecast mirrored: with anchor = first position holding a forecast value R and
   * open = max(0, totalScope[anchor] − completed[anchor]): completed[anchor] + open × (1 − max(0, R[i]) / R[anchor])
   * from the anchor on (null before; flat at completed[anchor] when R[anchor] ≤ 0). Joins Completed at the
   * anchor, never falls, meets Total where R reaches 0. All null when there is no forecast, or no Completed /
   * Total value at the anchor.
   */
  forecast: Value[]
  /** First position after the anchor where the forecast remaining reaches 0 (projected completion); else null. */
  projectedDone: { index: number; date: IsoDate } | null
  /**
   * Total − Forecast on the due date when the forecast never completes and the axis ends on the due date;
   * else null.
   */
  openAtDue: number | null
  /** Today's position on a live iteration (red dot, as on the burndown); −1 otherwise. */
  todayIndex: number
}

/**
 * Amendment B: all burnup series for an (already repaired, date-sorted) series on the burndown `axis`, with the
 * burndown forecast `forecastRemaining` (remaining work per position, §8). Pure; does not mutate input.
 */
export function burnup(
  series: SeriesPoint[],
  axis: IsoDate[],
  forecastRemaining: Value[],
  todayIndex: number,
  dueDate: IsoDate | null,
): BurnupModel {
  const byDate = pointsByDate(series)
  const completed = axis.map((d) => byDate.get(d)?.delivered ?? null)
  const scopeProjectedFrom = series.length === 0 ? -1 : axis.indexOf(latestDate(series))
  const lastScope = scopeProjectedFrom < 0 ? null : byDate.get(axis[scopeProjectedFrom])!.committed
  const totalScope = axis.map((d, i) =>
    scopeProjectedFrom >= 0 && i > scopeProjectedFrom ? lastScope : (byDate.get(d)?.committed ?? null),
  )

  const { firstIndex, totalDays } = axisMetrics(axis, series)
  const span = axis.length - 1 - firstIndex
  const firstCommitted = firstIndex < 0 ? 0 : byDate.get(axis[firstIndex])!.committed
  // c × k/n is exactly c at k = n.
  const ideal = axis.map((_, pos) =>
    firstIndex < 0 || span <= 0 || pos < firstIndex ? null : (firstCommitted * (pos - firstIndex)) / totalDays,
  )

  const empty = { forecast: axis.map(() => null), projectedDone: null, openAtDue: null }
  const anchor = forecastRemaining.findIndex((v) => v !== null)
  const anchorCompleted = anchor < 0 ? null : (completed[anchor] ?? null)
  const anchorScope = anchor < 0 ? null : (totalScope[anchor] ?? null)
  const dueIndex = dueDate === null ? -1 : axis.indexOf(dueDate)
  const projection =
    anchor < 0 || anchorCompleted === null || anchorScope === null
      ? empty
      : project(forecastRemaining, axis, anchor, anchorCompleted, anchorScope, dueIndex)

  return { axis, dueDate, completed, totalScope, scopeProjectedFrom, ideal, ...projection, todayIndex }
}

function project(
  r: Value[],
  axis: IsoDate[],
  anchor: number,
  anchorCompleted: number,
  anchorScope: number,
  dueIndex: number,
) {
  const start = r[anchor]!
  // The open work at the anchor (Total − Completed) is burnt at the pace of the burndown forecast, so the
  // forecast joins Completed at the anchor and meets Total exactly when R reaches 0 — even on a repaired point
  // whose remaining is the in-progress total rather than committed − delivered. Nothing to burn (R ≤ 0,
  // including a negative remaining, §7.1) → flat at Completed.
  const open = Math.max(0, anchorScope - anchorCompleted)
  const burnt = (v: number) => (start > 0 ? open * (1 - Math.max(0, v) / start) : 0)
  const forecast = axis.map((_, i) => {
    const v = r[i]
    return i < anchor || v === null || v === undefined ? null : anchorCompleted + burnt(v)
  })
  let projectedDone: BurnupModel['projectedDone'] = null
  if (start > 0 && open > 0) {
    const index = r.findIndex((v, i) => i > anchor && v !== null && v <= 0)
    if (index >= 0) projectedDone = { index, date: axis[index] }
  }
  // Open on the due date: only when the axis really ends on the due date and the forecast reaches it.
  const atDue = dueIndex >= 0 && dueIndex === axis.length - 1 ? forecast[dueIndex] : null
  const openAtDue =
    projectedDone === null && atDue !== null && atDue !== undefined && anchorCompleted + open - atDue > 0
      ? anchorCompleted + open - atDue
      : null
  return { forecast, projectedDone, openAtDue }
}
