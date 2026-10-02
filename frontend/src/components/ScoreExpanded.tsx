// §11.3 expanded score layout — implemented but never rendered (ledger #19).
import type { ScorePresentation } from '../domain/predictability'
import { S } from '../strings'

export function ScoreExpanded({ score }: { score: ScorePresentation }) {
  return (
    <>
      <div className="score-expanded-head">
        <h3 className="score-heading">{S.scoreExpandedHeading}</h3>
        <span className="muted">{score.analysed}</span>
      </div>
      <div className="score-blocks">
        <Block label={S.scoreAvgDeviation} text={score.averageDeviation.text} tone={score.averageDeviation.tone} />
        <Block
          label={S.scoreDeliveryDiff}
          text={score.deliveryDiff.text}
          tone={score.deliveryDiff.tone}
          caption={score.deliveryDiff.caption}
        />
        <Block
          label={S.scoreCompliant}
          text={score.compliant.text}
          tone={score.compliant.tone}
          caption={S.scoreCompliantCaption}
        />
        <Block label={S.scoreMedianVelocity} text={score.medianVelocity.text} caption={S.scoreVelocityCaption} />
      </div>
    </>
  )
}

function Block({ label, text, tone, caption }: { label: string; text: string; tone?: string; caption?: string }) {
  return (
    <div className="score-block">
      <span className="score-block-label">{label}</span>
      <strong data-tone={tone}>{text}</strong>
      {caption && <span className="muted">{caption}</span>}
    </div>
  )
}
