// §3.2 left rail: back control, heading, and the iteration rows (upcoming never listed, §5.3).
import type { UseQueryResult } from '@tanstack/react-query'
import type { Iteration } from '../api/types'
import { S } from '../strings'

interface Props {
  term: string
  iterations: UseQueryResult<Iteration[]>
  selectedId: string | null
  onSelect: (id: string) => void
  onBack: () => void
}

export function IterationChooser({ term, iterations, selectedId, onSelect, onBack }: Props) {
  const rows = iterations.data?.filter((it) => it.state !== 'upcoming') ?? []
  return (
    <nav className="rail iteration-rail" data-testid="iteration-rail" aria-label={S.iterationsHeading}>
      <button type="button" className="link-button" onClick={onBack}>
        {S.backToGroups(term)}
      </button>
      <h2 className="rail-heading">{S.iterationsHeading}</h2>
      {iterations.isPending ? (
        <div aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton skeleton-row" data-testid="iteration-placeholder" />
          ))}
        </div>
      ) : iterations.isError ? (
        <p className="error-text" role="alert">
          {iterations.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">{S.noIterations(term)}</p>
      ) : (
        <ul className="iteration-list">
          {rows.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="iteration-row"
                data-testid="iteration-row"
                aria-current={it.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(it.id)}
              >
                <span className="iteration-title">{it.title}</span>
                <span className="iteration-dates">{S.dateRange(it.startDate, it.dueDate)}</span>
                <StateBadge state={it.state} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

/** The raw state value (no literal exists for it, §13). */
export function StateBadge({ state }: { state: string }) {
  return (
    <span className="state-badge" data-state={state} data-testid="state-badge">
      {state}
    </span>
  )
}
