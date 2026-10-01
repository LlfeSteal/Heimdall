// HTTP contract between the Go backend and the frontend. See docs/SPEC.md "Implementation notes".
// The Go structs in backend/internal/api mirror these exactly (same JSON field names).

export interface AppConfig {
  groupTerm: string
  rootGroup: string
}

export interface GroupTile {
  fullPath: string
  name: string
  /** The group's own last path segment. */
  segment: string
}

export interface GroupCard extends GroupTile {
  children: GroupTile[]
}

/** `upcoming` and `closed` carry meaning; any other value is a live iteration (§5.3). */
export type IterationState = 'upcoming' | 'current' | 'closed' | (string & {})

export interface Iteration {
  id: string
  /** Iteration number, unique within a group only (§10.2). */
  iid: string
  title: string
  startDate: string | null
  dueDate: string | null
  state: IterationState
}

export interface SeriesPoint {
  date: string
  committed: number
  delivered: number
  /** committed − delivered, never clamped (§7.1). */
  remaining: number
}

export interface Total {
  weight: number
  count: number
}

export interface Report {
  series: SeriesPoint[]
  totals: {
    committed: Total
    delivered: Total
    inProgress: Total
  }
}

export interface IterationReport extends Iteration {
  report: Report | null
}

export interface ApiError {
  error: string
}
