// §12 in-chart delivery metrics for the displayed iteration (colours per A.6).
import type { Report } from '../api/types'
import { deliveryMetrics, presentMetrics } from '../domain/metrics'

export function MetricsStrip({ report }: { report: Report }) {
  const m = presentMetrics(deliveryMetrics(report))
  return (
    <div className="metrics-strip" data-testid="metrics-strip">
      <span className="metric" data-tone={m.deviationTone}>
        {m.deviationText}
      </span>
      <span className="metric" data-tone={m.diffTone}>
        {m.diffText}
      </span>
    </div>
  )
}
