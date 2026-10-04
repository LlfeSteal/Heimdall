// Amendment B: the words the burnup view reads out — the forecast caption and the tooltip's progress lines.
import { S } from '../strings'
import type { BurnupModel } from './curve'
import { daysBetween } from './dates'
import { formatPoints, formatShare } from './format'

/** The one-line forecast reading: projected completion date, or the work still open on the due date. */
export function forecastCaption(m: BurnupModel, closed: boolean): string | null {
  const due = m.dueDate
  if (due === null) return null
  if (m.projectedDone !== null) return S.burnupForecastDone(m.projectedDone.date, daysBetween(m.projectedDone.date, due))
  if (m.openAtDue !== null) {
    const points = formatPoints(m.openAtDue)
    return closed ? S.burnupClosedOpen(points, due) : S.burnupForecastOpen(points, due)
  }
  return null
}

/** Tooltip lines for one axis position: Remaining (Total − Completed) and % complete, when both exist. */
export function progressLines(m: BurnupModel, index: number): string[] {
  const total = m.totalScope[index]
  const done = m.completed[index]
  if (total === null || total === undefined || done === null || done === undefined) return []
  const lines = [S.tooltipRemaining(formatPoints(total - done))]
  if (total > 0) lines.push(S.tooltipComplete(formatShare((done / total) * 100)))
  return lines
}
