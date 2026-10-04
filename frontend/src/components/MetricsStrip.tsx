// §12 in-chart delivery metrics for the displayed iteration (colours per A.6): open iterations are measured
// against the burndown Ideal on today's date ("vs ideal"), closed ones on their final totals.
import type { IterationReport, Report } from '../api/types'
import { todayUtc } from '../domain/dates'
import { iterationMetrics, presentMetrics } from '../domain/metrics'
import { S } from '../strings'

export function MetricsStrip({ iteration }: { iteration: IterationReport & { report: Report } }) {
  const metrics = iterationMetrics(iteration, todayUtc())
  const m = presentMetrics(metrics)
  return (
    <div className="metrics-strip" data-testid="metrics-strip">
      <span className="metric" data-tone={m.deviationTone}>
        {m.deviationText}
      </span>
      <span className="metric" data-tone={m.diffTone}>
        {m.diffText}
      </span>
      {metrics.vsIdeal && <span className="muted metric-ref">{S.metricsVsIdeal}</span>}
    </div>
  )
}
