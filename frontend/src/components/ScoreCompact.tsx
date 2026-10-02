// §11.3 compact score layout (the one in use).
import type { ScorePresentation } from '../domain/predictability'
import { S } from '../strings'

export function ScoreCompact({ score }: { score: ScorePresentation }) {
  return (
    <>
      <h3 className="score-heading">{S.scoreCompactHeading}</h3>
      <dl className="score-rows">
        <div>
          <dt>{S.scoreAvgDeviation}</dt>
          <dd data-tone={score.averageDeviation.tone}>{score.averageDeviation.text}</dd>
        </div>
        <div>
          <dt>{S.scoreDeliveryDiff}</dt>
          <dd data-tone={score.deliveryDiff.tone}>{score.deliveryDiff.text}</dd>
        </div>
        <div>
          <dt>{S.scoreCompliant}</dt>
          <dd data-tone={score.compliant.tone}>{score.compliant.text}</dd>
        </div>
        <div>
          <dt>{S.scoreMedianVelocity}</dt>
          <dd>{score.medianVelocity.text}</dd>
        </div>
      </dl>
    </>
  )
}
