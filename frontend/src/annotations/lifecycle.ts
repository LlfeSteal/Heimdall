// Framework-free annotation lifecycle (SPEC §10.3, §3.3, §3.5, §14.3).
// Contract: docs/conformance/annotations.md
//
// The reducer is PURE. Side effects (asking `confirm`, reading the clock, touching storage) belong to the
// caller (`useAnnotations`). The caller asks `guardNavigation` before dispatching `openPoint` /
// `openAnnotation`, and calls `buildAnnotationToSave` before writing.
//
// Invariant: `selectedDate === (dialogue?.date ?? null)` — a point is selected exactly while the dialogue is
// open on it. Closing the dialogue (save, cancel, reset) clears the selection.

import { S } from '../strings'
import {
  DEFAULT_ANNOTATION_TYPE,
  annotationsOnDate,
  effectiveType,
  type Annotation,
  type AnnotationType,
} from './model'

export type DialogueMode = 'add' | 'edit'

export interface Dialogue {
  /** `add` → heading `Add annotation`, action `Add`; `edit` → `Edit annotation`, action `Edit` (§3.3). */
  mode: DialogueMode
  /** The selected point's date (`YYYY-MM-DD`); for `edit` it is the edited annotation's date. */
  date: string
  /** The annotation being edited (`edit` mode), else null. */
  editing: Annotation | null
  /** Current field values. */
  text: string
  type: AnnotationType
  /** Values the dialogue was opened with: '' / 'information' for add; the annotation's text / effective type for edit. */
  initialText: string
  initialType: AnnotationType
}

export interface LifecycleState {
  selectedDate: string | null
  dialogue: Dialogue | null
}

export const INITIAL_LIFECYCLE_STATE: LifecycleState = { selectedDate: null, dialogue: null }

export type LifecycleAction =
  /** Open a group, select an iteration, leave the group: no selection, dialogue closed, unsaved text discarded. */
  | { kind: 'reset' }
  /**
   * Point click (already guarded). Selects `date` and opens the dialogue pre-filled with the FIRST annotation
   * of `annotations` (the current pair's list, in save order) whose date equals `date` → `edit` mode;
   * none → empty `add` mode with type `information`.
   */
  | { kind: 'openPoint'; date: string; annotations: readonly Annotation[] }
  /** Edit from the list (already guarded): selects `annotation.date`, opens `edit` mode on THAT annotation. */
  | { kind: 'openAnnotation'; annotation: Annotation }
  | { kind: 'setText'; text: string }
  | { kind: 'setType'; type: AnnotationType }
  /** Cancel, or after a successful save: closes the dialogue and clears the selection. */
  | { kind: 'close' }

function addDialogue(date: string): Dialogue {
  const type = DEFAULT_ANNOTATION_TYPE
  return { mode: 'add', date, editing: null, text: '', type, initialText: '', initialType: type }
}

function editDialogue(annotation: Annotation): Dialogue {
  const type = effectiveType(annotation)
  const { date, text } = annotation
  return { mode: 'edit', date, editing: annotation, text, type, initialText: text, initialType: type }
}

function opened(dialogue: Dialogue): LifecycleState {
  return { selectedDate: dialogue.date, dialogue }
}

/** Pure reducer. `setText` / `setType` with no open dialogue return the state unchanged. */
export function lifecycleReducer(state: LifecycleState, action: LifecycleAction): LifecycleState {
  switch (action.kind) {
    case 'reset':
    case 'close':
      return INITIAL_LIFECYCLE_STATE
    case 'openPoint': {
      const [first] = annotationsOnDate(action.annotations, action.date)
      return opened(first ? editDialogue(first) : addDialogue(action.date))
    }
    case 'openAnnotation':
      return opened(editDialogue(action.annotation))
    case 'setText':
      return state.dialogue ? { ...state, dialogue: { ...state.dialogue, text: action.text } } : state
    case 'setType':
      return state.dialogue ? { ...state, dialogue: { ...state.dialogue, type: action.type } } : state
  }
}

/**
 * §10.3 dirty rule: dialogue open AND (`text.trim() !== initialText.trim()` OR `type !== initialType`).
 * null → false. A just-opened dialogue is never dirty; whitespace-only typing is not dirty.
 */
export function isDirty(dialogue: Dialogue | null): boolean {
  if (!dialogue) return false
  return dialogue.text.trim() !== dialogue.initialText.trim() || dialogue.type !== dialogue.initialType
}

/** Text is required (§3.3): true iff a dialogue is open and `text.trim() !== ''`. */
export function canSave(dialogue: Dialogue | null): boolean {
  return dialogue !== null && dialogue.text.trim() !== ''
}

export type NavigationTarget = { kind: 'point'; date: string } | { kind: 'annotation'; id: string }

/**
 * What the caller must do before navigating (§3.5, §10.3):
 * - `proceed` — no dialogue, or a clean one (a clean re-click of the open point re-opens it on the FIRST
 *               annotation of that date, §10.3).
 * - `noop`    — the dialogue is dirty and the target is what it already shows (point: `dialogue.date === date`;
 *               annotation: `dialogue.editing?.id === id`): do nothing at all, never ask, unsaved text kept.
 * - `confirm` — the dialogue is dirty and the target differs: ask `S.unsavedPrompt`; declining changes nothing.
 */
export function guardNavigation(
  state: LifecycleState,
  target: NavigationTarget,
): 'noop' | 'confirm' | 'proceed' {
  const { dialogue } = state
  if (!dialogue || !isDirty(dialogue)) return 'proceed'
  // Dirty: re-targeting what is already open must not prompt nor lose the text (§3.5: a *different* point).
  const alreadyOpen =
    target.kind === 'point' ? dialogue.date === target.date : dialogue.editing?.id === target.id
  return alreadyOpen ? 'noop' : 'confirm'
}

/**
 * The annotation to persist from the open dialogue, or null when nothing may be saved (no dialogue, empty
 * `groupPath`/`iterationId`, or `!canSave`).
 * - add:  `{ id: String(now), groupPath, iterationId, date: dialogue.date, author: S.currentUser,
 *           text: text.trim(), type, createdAt: new Date(now).toISOString() }`
 * - edit: same, but `id`, `createdAt`, and `date` are the edited annotation's own; author is `S.currentUser`.
 * `type` is always written explicitly.
 */
export function buildAnnotationToSave(
  dialogue: Dialogue | null,
  context: { groupPath: string | null | undefined; iterationId: string | null | undefined; now: number },
): Annotation | null {
  const { groupPath, iterationId, now } = context
  if (!dialogue || !groupPath || !iterationId || !canSave(dialogue)) return null
  const { editing } = dialogue
  return {
    id: editing ? editing.id : String(now),
    groupPath,
    iterationId,
    date: editing ? editing.date : dialogue.date,
    author: S.currentUser,
    text: dialogue.text.trim(),
    type: dialogue.type,
    createdAt: editing ? editing.createdAt : new Date(now).toISOString(),
  }
}
