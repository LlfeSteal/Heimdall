// §11.3 predictability panel: one region with its own loading / error / timeout / none states.
import type { ScorePresentation } from '../domain/predictability'
import { S } from '../strings'
import { ScoreCompact } from './ScoreCompact'
import { ScoreExpanded } from './ScoreExpanded'

export type ScoreState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; score: ScorePresentation }

interface Props {
  state: ScoreState
  /** The product only uses `compact`; `expanded` is supported but unreachable (ledger #19). */
  layout?: 'compact' | 'expanded'
}

export function ScorePanel({ state, layout = 'compact' }: Props) {
  const compact = layout === 'compact'
  return (
    <section className="score-panel" data-testid="score-panel" aria-live="polite">
      {state.kind === 'ready' ? (
        compact ? (
          <ScoreCompact score={state.score} />
        ) : (
          <ScoreExpanded score={state.score} />
        )
      ) : (
        <p className="score-status" data-tone={state.kind === 'error' || state.kind === 'timeout' ? 'poor' : undefined}>
          {statusText(state, compact)}
        </p>
      )}
    </section>
  )
}

function statusText(state: Exclude<ScoreState, { kind: 'ready' }>, compact: boolean): string {
  switch (state.kind) {
    case 'loading':
      return compact ? S.scoreLoading : S.scoreCalculating
    case 'none':
      return compact ? S.scoreNone : S.scoreNoData
    case 'timeout':
      return S.scoreTimeout
    case 'error':
      return S.scoreError(state.message)
  }
}
