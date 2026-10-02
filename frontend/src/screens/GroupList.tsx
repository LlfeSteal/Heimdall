// Screen 1 — group list (SPEC §3.1, Amendment A.3/A.4).
import type { UseQueryResult } from '@tanstack/react-query'
import type { AppConfig, GroupCard, GroupTile } from '../api/types'
import { useGroups } from '../api/queries'
import { S } from '../strings'

interface Props {
  config: UseQueryResult<AppConfig>
  gen: number
  onRefresh: () => void
  onSelect: (group: GroupTile) => void
}

export function GroupList({ config, gen, onRefresh, onSelect }: Props) {
  const groups = useGroups(gen)
  const retry = () => {
    if (config.isError) void config.refetch()
    onRefresh()
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{S.productTitle}</h1>
      </header>
      <main className="group-list">
        {config.isError || groups.isError ? (
          <section className="state-box" data-tone="poor">
            <h2>{S.groupLoadingError}</h2>
            <p className="error-text">{(config.error ?? groups.error)?.message}</p>
            <button type="button" onClick={retry}>
              {S.retry}
            </button>
          </section>
        ) : config.isPending || groups.isPending ? (
          <div className="card-grid" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton skeleton-card" data-testid="group-placeholder" />
            ))}
          </div>
        ) : (
          <Populated config={config.data} cards={groups.data} onRefresh={onRefresh} onSelect={onSelect} />
        )}
      </main>
    </div>
  )
}

interface PopulatedProps {
  config: AppConfig
  cards: GroupCard[]
  onRefresh: () => void
  onSelect: (group: GroupTile) => void
}

function Populated({ config, cards, onRefresh, onSelect }: PopulatedProps) {
  const { groupTerm: term, rootGroup: root } = config
  const refresh = (
    <button type="button" onClick={onRefresh}>
      {S.refresh}
    </button>
  )

  if (cards.length === 0) {
    const body = S.noGroupBody(term, root)
    return (
      <section className="state-box">
        <h2>{S.noGroupHeading(term)}</h2>
        <p>
          {body.before}
          <code>{body.code}</code>
          {body.after}
        </p>
        {refresh}
      </section>
    )
  }

  const guidance = S.groupGuidance(term, root)
  return (
    <>
      <div className="list-heading">
        {/* ledger #3: n counts the cards, not the groups. */}
        <h2>{S.availableGroups(term, cards.length)}</h2>
        {refresh}
      </div>
      <p className="muted">
        {guidance.before}
        <code>{guidance.code}</code>
        {guidance.after}
      </p>
      <div className="card-grid">
        {cards.map((card) => (
          <article key={card.fullPath} className="group-card" data-testid="group-card">
            <button type="button" className="group-card-main" onClick={() => onSelect(card)}>
              <span className="category">{card.segment}</span>
              <span className="group-name">{card.name}</span>
              <span className="group-path">{card.fullPath}</span>
            </button>
            {card.children.length > 0 && (
              <div className="tiles">
                {/* Tiles are siblings of the card button, so a tile click selects only that child. */}
                {card.children.map((tile) => (
                  <button
                    key={tile.fullPath}
                    type="button"
                    className="tile"
                    data-testid="group-tile"
                    onClick={() => onSelect(tile)}
                  >
                    <span className="tile-name">{tile.name}</span>
                    <span className="tile-segment">{tile.segment}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  )
}
