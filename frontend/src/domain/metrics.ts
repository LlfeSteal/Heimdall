// In-chart delivery metrics strip (SPEC §12) and delivery summary strip (§3.2).
import type { Report } from '../api/types'
import { S } from '../strings'
import { deviationTone, differenceTone, type Tone } from './colorScale'
import { buildAxis, completeSeries, type CurveIteration, idealSeries, remainingSeries } from './curve'
import type { IsoDate } from './dates'
import { isClosed } from './state'
import { formatShare, formatSignedPoints, oneDecimal } from './format'

export interface DeliveryMetrics {
  committed: number
  delivered: number
  /** committed > 0 ? |committed − delivered| / committed × 100 : 0 — a PERCENT. */
  deviation: number
  /** committed − delivered (signed). */
  difference: number
}

/** §12 from report.totals.committed.weight / delivered.weight of the DISPLAYED iteration. */
export function deliveryMetrics(report: Report): DeliveryMetrics {
  const committed = report.totals.committed.weight
  const delivered = report.totals.delivered.weight
  const difference = committed - delivered
  const deviation = committed > 0 ? (Math.abs(difference) / committed) * 100 : 0
  return { committed, delivered, deviation, difference }
}

export interface IterationMetrics extends DeliveryMetrics {
  /** true when the figures are measured against the burndown Ideal on today's date (open iteration). */
  vsIdeal: boolean
}

/**
 * §12 for the displayed iteration. Closed → `deliveryMetrics(report)` (final committed vs delivered).
 * Open (any other state) → against the burndown Ideal on today's date (UTC): difference = actual remaining −
 * ideal remaining (positive = behind), deviation = |difference| / committed × 100 (0 when committed ≤ 0).
 * Falls back to `deliveryMetrics(report)` when today is not on the axis or has no value there.
 */
export function iterationMetrics(iteration: CurveIteration & { report: Report }, today: IsoDate): IterationMetrics {
  const totals = deliveryMetrics(iteration.report)
  if (isClosed(iteration.state)) return { ...totals, vsIdeal: false }
  const series = completeSeries(iteration, today)
  const axis = buildAxis(series, iteration.dueDate)
  const i = axis.indexOf(today)
  const actual = i < 0 ? null : remainingSeries(series, axis)[i]
  const ideal = i < 0 ? null : idealSeries(series, axis)[i]
  if (actual === null || ideal === null) return { ...totals, vsIdeal: false }
  const difference = actual - ideal
  const deviation = totals.committed > 0 ? (Math.abs(difference) / totals.committed) * 100 : 0
  return { ...totals, difference, deviation, vsIdeal: true }
}

export interface MetricsPresentation {
  /** `${S.metricsDeviation} ${deviation.toFixed(1)}%` → e.g. "Deviation: 10.0%" (§12 literal, no space before %). */
  deviationText: string
  deviationTone: Tone
  /** `${S.metricsDiff} ${formatSignedPoints(difference)}` → e.g. "Diff: +5.0 pts". */
  diffText: string
  diffTone: Tone
}

/** §12 rendering + colours (A.6: deviationTone / differenceTone). */
export function presentMetrics(metrics: DeliveryMetrics): MetricsPresentation {
  return {
    deviationText: `${S.metricsDeviation} ${oneDecimal(metrics.deviation)}%`,
    deviationTone: deviationTone(metrics.deviation),
    diffText: `${S.metricsDiff} ${formatSignedPoints(metrics.difference)}`,
    diffTone: differenceTone(metrics.difference),
  }
}

export interface DeliverySummary {
  /** delivered ÷ committed × 100; 0 when committed is 0. */
  completedPercent: number
  /** inProgress ÷ committed × 100; 0 when committed is 0. */
  inProgressPercent: number
  /** formatShare(completedPercent), e.g. "90%". */
  completedShare: string
  inProgressShare: string
  /** S.summaryOf(oneDecimal(delivered), oneDecimal(committed)), e.g. "45.0 of 50.0". */
  completedOf: string
  /** S.summaryOf(oneDecimal(inProgress), oneDecimal(committed)). */
  inProgressOf: string
}

/** §3.2 delivery summary strip from report.totals (weights). */
export function deliverySummary(report: Report): DeliverySummary {
  const committed = report.totals.committed.weight
  const delivered = report.totals.delivered.weight
  const inProgress = report.totals.inProgress.weight
  const percentOf = (part: number) => (committed === 0 ? 0 : (part / committed) * 100)
  const completedPercent = percentOf(delivered)
  const inProgressPercent = percentOf(inProgress)
  return {
    completedPercent,
    inProgressPercent,
    completedShare: formatShare(completedPercent),
    inProgressShare: formatShare(inProgressPercent),
    completedOf: S.summaryOf(oneDecimal(delivered), oneDecimal(committed)),
    inProgressOf: S.summaryOf(oneDecimal(inProgress), oneDecimal(committed)),
  }
}
