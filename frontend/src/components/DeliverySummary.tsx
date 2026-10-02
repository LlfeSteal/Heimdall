// §3.2 delivery summary strip.
import type { Report } from '../api/types'
import { deliverySummary } from '../domain/metrics'
import { S } from '../strings'

export function DeliverySummary({ report }: { report: Report }) {
  const s = deliverySummary(report)
  return (
    <div className="delivery-summary" data-testid="delivery-summary">
      <span className="summary-item">
        <span className="dot" data-colour="green" aria-hidden="true" />
        <span>{S.summaryCompleted}</span>
        <strong>{s.completedShare}</strong>
        <span className="muted">{s.completedOf}</span>
      </span>
      <span className="summary-item">
        <span className="dot" data-colour="blue" aria-hidden="true" />
        <span>{S.summaryInProgress}</span>
        <strong>{s.inProgressShare}</strong>
        <span className="muted">{s.inProgressOf}</span>
      </span>
    </div>
  )
}
