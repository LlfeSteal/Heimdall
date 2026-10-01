// React hook: the §10.3 lifecycle (lifecycle.ts) wired to storage (storage.ts).
// Contract: docs/conformance/annotations.md

import { useReducer, useState } from 'react'
import { S } from '../strings'
import {
  INITIAL_LIFECYCLE_STATE,
  buildAnnotationToSave,
  canSave,
  guardNavigation,
  isDirty,
  lifecycleReducer,
  type DialogueMode,
  type NavigationTarget,
} from './lifecycle'
import type { Annotation, AnnotationType } from './model'
import * as store from './storage'
import type { StorageArg } from './storage'

export interface UseAnnotationsOptions {
  /** Selected group's full path; null/undefined/'' = no group (list empty, everything cleared). */
  groupPath: string | null | undefined
  /** Selected iteration NUMBER (`Iteration.iid`); null/undefined/'' = no iteration (list empty). */
  iterationId: string | null | undefined
  /** Passed through to storage.ts (undefined → default browser storage, null → no storage). */
  storage?: StorageArg
  /** Unsaved-changes prompt. Default: `window.confirm` (treated as accepting when unavailable). */
  confirm?: (message: string) => boolean
  /** Clock in epoch ms. Default: `Date.now`. Used for a new annotation's id and createdAt only. */
  now?: () => number
}

export interface DialogueView {
  mode: DialogueMode
  date: string
  text: string
  type: AnnotationType
  /** Id of the annotation being edited (`edit` mode), else null. */
  annotationId: string | null
}

export interface UseAnnotationsResult {
  /**
   * The current pair's annotations in save order, as last READ FROM STORAGE. Re-read on mount, whenever
   * groupPath/iterationId change, and after every save / delete — never optimistic. [] when the pair is
   * incomplete.
   */
  annotations: Annotation[]
  /** Selected point date; equals `dialogue?.date ?? null`. */
  selectedDate: string | null
  dialogue: DialogueView | null
  /** §10.3 dirty rule (trimmed text / exact type vs. the values the dialogue opened with). */
  dirty: boolean
  /** Text required: false when no dialogue or trimmed text is empty. UI disables the Add/Edit action on false. */
  canSave: boolean
  /**
   * Point click. Same date as the open dialogue → nothing. Dirty → `confirm(S.unsavedPrompt)`; declining
   * changes NOTHING. Otherwise selects the date and opens the dialogue on the FIRST annotation of that date
   * (edit) or empty (add).
   */
  clickPoint: (date: string) => void
  /** `Edit` in the list: same guard as clickPoint (no-op if that annotation is already open), then opens it. Unknown id → nothing. */
  editFromList: (id: string) => void
  setText: (text: string) => void
  setType: (type: AnnotationType) => void
  /**
   * `Add`/`Edit`. When `!canSave` → ignored entirely (nothing written, dialogue stays open). Otherwise writes
   * through `storage.save`, re-reads the list from storage, closes the dialogue and clears the selection.
   */
  save: () => void
  /** `Cancel`: closes the dialogue, clears the selection, discards the text. Nothing is written. */
  cancel: () => void
  /**
   * `Delete` in the list (no prompt): `storage.remove(id, groupPath, iterationId)` then re-read. If the deleted
   * annotation is the one open in the dialogue, the dialogue closes; otherwise the dialogue is untouched.
   */
  remove: (id: string) => void
}

/**
 * When `groupPath` or `iterationId` changes (open a group, select an iteration, leave the group), the selection
 * is cleared and the dialogue closed WITHOUT asking (§10.3, §14.3), and the list is re-read for the new pair.
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotationsResult {
  const { groupPath, iterationId, storage, confirm = defaultConfirm, now = Date.now } = options
  const read = () => store.listFor(groupPath, iterationId, storage)

  const pairKey = JSON.stringify([groupPath || '', iterationId || ''])
  const [currentPair, setCurrentPair] = useState(pairKey)
  const [annotations, setAnnotations] = useState(read)
  const [state, dispatch] = useReducer(lifecycleReducer, INITIAL_LIFECYCLE_STATE)

  // Pair changed: reset during render (no prompt) so the very next result is already clean (§10.3, §14.3).
  if (currentPair !== pairKey) {
    setCurrentPair(pairKey)
    setAnnotations(read())
    dispatch({ kind: 'reset' })
  }

  /** §3.5 guard: true when navigation may go ahead. Declining leaves every piece of state untouched. */
  const mayNavigate = (target: NavigationTarget) => {
    const verdict = guardNavigation(state, target)
    return verdict === 'proceed' || (verdict === 'confirm' && confirm(S.unsavedPrompt))
  }

  const { dialogue } = state
  return {
    annotations,
    selectedDate: state.selectedDate,
    dialogue: dialogue && {
      mode: dialogue.mode,
      date: dialogue.date,
      text: dialogue.text,
      type: dialogue.type,
      annotationId: dialogue.editing?.id ?? null,
    },
    dirty: isDirty(dialogue),
    canSave: canSave(dialogue),
    clickPoint(date) {
      if (mayNavigate({ kind: 'point', date })) dispatch({ kind: 'openPoint', date, annotations })
    },
    editFromList(id) {
      const annotation = annotations.find((a) => a.id === id)
      if (!annotation || !mayNavigate({ kind: 'annotation', id })) return
      dispatch({ kind: 'openAnnotation', annotation })
    },
    setText: (text) => dispatch({ kind: 'setText', text }),
    setType: (type) => dispatch({ kind: 'setType', type }),
    save() {
      const annotation = buildAnnotationToSave(dialogue, { groupPath, iterationId, now: now() })
      if (!annotation) return
      store.save(annotation, storage)
      setAnnotations(read()) // storage is the source of truth, never optimistic state
      dispatch({ kind: 'close' })
    },
    cancel: () => dispatch({ kind: 'close' }),
    remove(id) {
      if (groupPath && iterationId) store.remove(id, groupPath, iterationId, storage)
      setAnnotations(read())
      if (dialogue?.editing?.id === id) dispatch({ kind: 'close' })
    },
  }
}

function defaultConfirm(message: string): boolean {
  return typeof window === 'undefined' || typeof window.confirm !== 'function' || window.confirm(message)
}
