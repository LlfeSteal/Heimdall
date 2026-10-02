// Predictability score (SPEC §11, §15.3, A.6).
import type { IterationReport } from '../api/types'
import { S } from '../strings'
import { compliantTone, deviationTone, differenceTone, type Tone } from './colorScale'
import { formatPercentOneDecimal, formatPoints, formatSignedPoints, formatWholePercent } from './format'
import { mean, median, settle } from './stats'

/** §2.3 predictability window: last 4 closed iterations. */
export const PREDICTABILITY_WINDOW = 4
/** §2.3 compliant ⇔ deviation (fraction) STRICTLY below 0.10. */
export const COMPLIANT_THRESHOLD = 0.1

/** "No score" — a distinct state, never zero. Renders as `S.scoreNone` / `S.scoreNoData`. */
export const NO_SCORE: unique symbol = Symbol('no-score')
export type NoScore = typeof NO_SCORE

export interface PredictabilityScore {
  /** Mean of |committed − delivered| / committed — a FRACTION (e.g. 0.0875). */
  averageDeviation: number
  /** Mean of (committed − delivered) — SIGNED points; positive ⇒ under-delivered. */
  averageDifference: number
  /** Median of the DELIVERED workloads. */
  medianVelocity: number
  /** count(deviation < 0.10) ÷ records × 100 — a PERCENT (0…100). */
  compliantShare: number
  /** Number of records. */
  analysedCount: number
}

/**
 * §11.2 selector: the iterations with state === 'closed' from the NEWEST-FIRST list, at most the first
 * `max` (4), in list order. Returns [] when there is none — the caller MUST then report NO_SCORE without
 * issuing any data read.
 */
export function closedForScore(iterations: IterationReport[], max: number = PREDICTABILITY_WINDOW): IterationReport[] {
  return iterations.filter((it) => it.state === 'closed').slice(0, max)
}

/**
 * §11.2 score from the (≤ 4) closed iterations, using only the report data they carry.
 * Skip an iteration unless report != null AND report.totals.committed.weight > 0.
 * committed = totals.committed.weight, delivered = totals.delivered.weight,
 * difference = committed − delivered (signed), deviation = |difference| / committed.
 * No record (including an empty input) → NO_SCORE.
 */
export function predictability(closed: IterationReport[]): PredictabilityScore | NoScore {
  const records = closed.flatMap(({ report }) => {
    if (report === null || report.totals.committed.weight <= 0) return []
    const committed = report.totals.committed.weight
    const delivered = report.totals.delivered.weight
    const difference = committed - delivered
    return [{ deviation: Math.abs(difference) / committed, difference, delivered }]
  })
  if (records.length === 0) return NO_SCORE
  // Strict "< 10 %", compared after settling float noise so it cannot flip the boundary.
  const compliant = records.filter((r) => settle(r.deviation) < COMPLIANT_THRESHOLD).length
  return {
    averageDeviation: mean(records.map((r) => r.deviation)),
    averageDifference: mean(records.map((r) => r.difference)),
    medianVelocity: median(records.map((r) => r.delivered)),
    compliantShare: (compliant / records.length) * 100,
    analysedCount: records.length,
  }
}

export interface ScoreFigure {
  text: string
  tone: Tone
}

export interface ScorePresentation {
  /** formatPercentOneDecimal(averageDeviation × 100), deviationTone(averageDeviation × 100). */
  averageDeviation: ScoreFigure
  /** formatSignedPoints(averageDifference), differenceTone(averageDifference). */
  deliveryDiff: ScoreFigure & { caption: string }
  /** formatWholePercent(compliantShare), compliantTone(compliantShare). */
  compliant: ScoreFigure
  /** formatPoints(medianVelocity) — never colour-coded. */
  medianVelocity: { text: string }
  /** S.scoreAnalyzed(analysedCount). */
  analysed: string
}

/**
 * §11.3 presentation. deliveryDiff.caption = S.scoreUnderDelivered when averageDifference ≥ 0, else
 * S.scoreOverDelivered. Tones per A.6.
 */
export function presentScore(score: PredictabilityScore): ScorePresentation {
  const deviationPercent = score.averageDeviation * 100
  return {
    averageDeviation: { text: formatPercentOneDecimal(deviationPercent), tone: deviationTone(deviationPercent) },
    deliveryDiff: {
      text: formatSignedPoints(score.averageDifference),
      tone: differenceTone(score.averageDifference),
      caption: score.averageDifference >= 0 ? S.scoreUnderDelivered : S.scoreOverDelivered,
    },
    compliant: { text: formatWholePercent(score.compliantShare), tone: compliantTone(score.compliantShare) },
    medianVelocity: { text: formatPoints(score.medianVelocity) },
    analysed: S.scoreAnalyzed(score.analysedCount),
  }
}
