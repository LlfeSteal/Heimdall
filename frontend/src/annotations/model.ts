// Annotation model (SPEC §10.1) and the scoping rule (§10.2).
// Contract: docs/conformance/annotations.md

/** §10.1 — information / risk. Absence of a type on a stored annotation means `information`. */
export type AnnotationType = 'information' | 'risk'

/** §10.1 — "absence means information". */
export const DEFAULT_ANNOTATION_TYPE: AnnotationType = 'information'

/**
 * One annotation (§10.1). It belongs to a (groupPath, iterationId) pair — never to an iteration number
 * alone (§10.2).
 */
export interface Annotation {
  /** Derived from the clock at creation time: `String(now())` (epoch milliseconds). Kept across edits. */
  id: string
  /** Full path of the GitLab group, e.g. `org/delivery/alpha`. */
  groupPath: string
  /** The iteration NUMBER (`Iteration.iid`) as a string. Unique only within a group. */
  iterationId: string
  /** Date of the curve point the annotation is pinned to, `YYYY-MM-DD`. */
  date: string
  /** Always `S.currentUser` (§10.3) — no identity integration. */
  author: string
  /** Free text, newlines allowed. Persisted trimmed (see conformance checklist). */
  text: string
  /** Optional; absent ⇒ `information`. Annotations saved by this product always carry it explicitly. */
  type?: AnnotationType
  /** Creation timestamp, ISO-8601 (`new Date(now()).toISOString()`), preserved across edits. */
  createdAt: string
}

/** The type to display / compare for an annotation: its `type`, or `information` when absent. */
export function effectiveType(annotation: Pick<Annotation, 'type'>): AnnotationType {
  return annotation.type ?? DEFAULT_ANNOTATION_TYPE
}

/**
 * True when `annotation` belongs to the pair (groupPath, iterationId) — both fields must match exactly.
 * Always false when either `groupPath` or `iterationId` is null/undefined/empty (§10.2: never "all").
 */
export function belongsTo(
  annotation: Pick<Annotation, 'groupPath' | 'iterationId'>,
  groupPath: string | null | undefined,
  iterationId: string | null | undefined,
): boolean {
  if (!groupPath || !iterationId) return false
  return annotation.groupPath === groupPath && annotation.iterationId === iterationId
}

/**
 * All annotations of `list` pinned to `date`, in list (= save) order. Used for the tooltip (all of them,
 * one per line) and by the lifecycle (the FIRST one is what a point click opens).
 */
export function annotationsOnDate(list: readonly Annotation[], date: string): Annotation[] {
  return list.filter((a) => a.date === date)
}
