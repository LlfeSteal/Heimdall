import { describe, expect, it } from 'vitest'
import { S } from '../strings'
import {
  INITIAL_LIFECYCLE_STATE,
  buildAnnotationToSave,
  canSave,
  guardNavigation,
  isDirty,
  lifecycleReducer,
  type LifecycleState,
} from './lifecycle'
import { makeAnnotation } from './testStorage'

const D1 = '2026-09-10'
const D2 = '2026-09-11'

function openPoint(state: LifecycleState, date: string, annotations = [] as ReturnType<typeof makeAnnotation>[]) {
  return lifecycleReducer(state, { kind: 'openPoint', date, annotations })
}

describe('§10.3 reducer — opening', () => {
  it('LC01 initial state: nothing selected, no dialogue', () => {
    expect(INITIAL_LIFECYCLE_STATE).toEqual({ selectedDate: null, dialogue: null })
  })

  it('LC02 openPoint on a date without annotations → add mode, empty text, type information', () => {
    const s = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    expect(s.selectedDate).toBe(D1)
    expect(s.dialogue).toMatchObject({ mode: 'add', date: D1, editing: null, text: '', type: 'information' })
  })

  it('LC03 openPoint pre-fills with the FIRST annotation of that date (edit mode)', () => {
    const other = makeAnnotation({ date: D2 })
    const first = makeAnnotation({ date: D1, text: 'first', type: 'risk' })
    const second = makeAnnotation({ date: D1, text: 'second' })
    const s = openPoint(INITIAL_LIFECYCLE_STATE, D1, [other, first, second])
    expect(s.selectedDate).toBe(D1)
    expect(s.dialogue).toMatchObject({ mode: 'edit', date: D1, editing: first, text: 'first', type: 'risk' })
  })

  it('LC04 prefill of an annotation without type uses information', () => {
    const { type: _omit, ...noType } = makeAnnotation({ date: D1 })
    void _omit
    const s = openPoint(INITIAL_LIFECYCLE_STATE, D1, [noType])
    expect(s.dialogue?.type).toBe('information')
    expect(isDirty(s.dialogue)).toBe(false)
  })

  it('LC05 openAnnotation opens THAT annotation (not the first of its date) and selects its date', () => {
    const first = makeAnnotation({ date: D1, text: 'first' })
    const second = makeAnnotation({ date: D1, text: 'second' })
    void first
    const s = lifecycleReducer(INITIAL_LIFECYCLE_STATE, { kind: 'openAnnotation', annotation: second })
    expect(s.selectedDate).toBe(D1)
    expect(s.dialogue).toMatchObject({ mode: 'edit', editing: second, text: 'second', date: D1 })
  })

  it('LC06 reset clears selection and closes the dialogue (open group / select iteration / leave group)', () => {
    let s = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    s = lifecycleReducer(s, { kind: 'setText', text: 'unsaved' })
    s = lifecycleReducer(s, { kind: 'reset' })
    expect(s).toEqual({ selectedDate: null, dialogue: null })
  })

  it('LC07 close (cancel / after save) closes the dialogue and clears the selection', () => {
    let s = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    s = lifecycleReducer(s, { kind: 'setText', text: 'draft' })
    s = lifecycleReducer(s, { kind: 'close' })
    expect(s).toEqual({ selectedDate: null, dialogue: null })
  })

  it('LC08 setText / setType without an open dialogue leave the state unchanged', () => {
    expect(lifecycleReducer(INITIAL_LIFECYCLE_STATE, { kind: 'setText', text: 'x' })).toEqual(INITIAL_LIFECYCLE_STATE)
    expect(lifecycleReducer(INITIAL_LIFECYCLE_STATE, { kind: 'setType', type: 'risk' })).toEqual(INITIAL_LIFECYCLE_STATE)
  })
})

describe('§10.3 dirty rules', () => {
  it('LC10 a just-opened dialogue is not dirty (add and edit)', () => {
    expect(isDirty(openPoint(INITIAL_LIFECYCLE_STATE, D1).dialogue)).toBe(false)
    const a = makeAnnotation({ date: D1, text: 'existing\n', type: 'risk' })
    expect(isDirty(openPoint(INITIAL_LIFECYCLE_STATE, D1, [a]).dialogue)).toBe(false)
    expect(isDirty(lifecycleReducer(INITIAL_LIFECYCLE_STATE, { kind: 'openAnnotation', annotation: a }).dialogue)).toBe(
      false,
    )
  })

  it('LC11 no dialogue → not dirty', () => {
    expect(isDirty(null)).toBe(false)
  })

  it('LC12 typing text marks dirty', () => {
    const s = lifecycleReducer(openPoint(INITIAL_LIFECYCLE_STATE, D1), { kind: 'setText', text: 'hello' })
    expect(s.dialogue?.text).toBe('hello')
    expect(isDirty(s.dialogue)).toBe(true)
  })

  it('LC13 whitespace-only typing (spaces, newlines, tabs) is not dirty', () => {
    for (const text of ['   ', '\n\n', ' \t\n ']) {
      const s = lifecycleReducer(openPoint(INITIAL_LIFECYCLE_STATE, D1), { kind: 'setText', text })
      expect(isDirty(s.dialogue)).toBe(false)
    }
  })

  it('LC14 edit: adding surrounding whitespace to the existing text is not dirty; changing it is', () => {
    const a = makeAnnotation({ date: D1, text: 'scope added' })
    const opened = openPoint(INITIAL_LIFECYCLE_STATE, D1, [a])
    expect(isDirty(lifecycleReducer(opened, { kind: 'setText', text: '  scope added \n' }).dialogue)).toBe(false)
    expect(isDirty(lifecycleReducer(opened, { kind: 'setText', text: 'scope added!' }).dialogue)).toBe(true)
  })

  it('LC15 changing the type marks dirty; changing it back is clean (exact comparison)', () => {
    const opened = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    const risk = lifecycleReducer(opened, { kind: 'setType', type: 'risk' })
    expect(risk.dialogue?.type).toBe('risk')
    expect(isDirty(risk.dialogue)).toBe(true)
    const back = lifecycleReducer(risk, { kind: 'setType', type: 'information' })
    expect(isDirty(back.dialogue)).toBe(false)
  })

  it('LC16 edit of a type-less annotation: choosing information is not dirty, risk is', () => {
    const { type: _omit, ...noType } = makeAnnotation({ date: D1 })
    void _omit
    const opened = openPoint(INITIAL_LIFECYCLE_STATE, D1, [noType])
    expect(isDirty(lifecycleReducer(opened, { kind: 'setType', type: 'information' }).dialogue)).toBe(false)
    expect(isDirty(lifecycleReducer(opened, { kind: 'setType', type: 'risk' }).dialogue)).toBe(true)
  })

  it('LC17 canSave requires non-empty trimmed text', () => {
    const opened = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    expect(canSave(null)).toBe(false)
    expect(canSave(opened.dialogue)).toBe(false)
    expect(canSave(lifecycleReducer(opened, { kind: 'setText', text: '  \n ' }).dialogue)).toBe(false)
    expect(canSave(lifecycleReducer(opened, { kind: 'setText', text: ' x ' }).dialogue)).toBe(true)
  })
})

describe('§3.5 / §10.3 navigation guard', () => {
  it('LC20 no dialogue → proceed', () => {
    expect(guardNavigation(INITIAL_LIFECYCLE_STATE, { kind: 'point', date: D1 })).toBe('proceed')
    expect(guardNavigation(INITIAL_LIFECYCLE_STATE, { kind: 'annotation', id: 'x' })).toBe('proceed')
  })

  it('LC21 clean dialogue, different target → proceed (no prompt)', () => {
    const s = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    expect(guardNavigation(s, { kind: 'point', date: D2 })).toBe('proceed')
    expect(guardNavigation(s, { kind: 'annotation', id: 'x' })).toBe('proceed')
  })

  it('LC22 dirty dialogue, different point or other annotation → confirm', () => {
    const s = lifecycleReducer(openPoint(INITIAL_LIFECYCLE_STATE, D1), { kind: 'setText', text: 'draft' })
    expect(guardNavigation(s, { kind: 'point', date: D2 })).toBe('confirm')
    expect(guardNavigation(s, { kind: 'annotation', id: 'x' })).toBe('confirm')
  })

  it('LC23 dirty dialogue, same point / same annotation → noop (no prompt, text kept)', () => {
    const a = makeAnnotation({ date: D1 })
    const s = lifecycleReducer(openPoint(INITIAL_LIFECYCLE_STATE, D1, [a]), { kind: 'setText', text: 'changed' })
    expect(guardNavigation(s, { kind: 'point', date: D1 })).toBe('noop')
    expect(guardNavigation(s, { kind: 'annotation', id: a.id })).toBe('noop')
  })

  it('LC24 clean dialogue, same point / same annotation → proceed (re-opens on the first annotation)', () => {
    const first = makeAnnotation({ date: D1, text: 'first' })
    const second = makeAnnotation({ date: D1, text: 'second' })
    const s = lifecycleReducer(INITIAL_LIFECYCLE_STATE, { kind: 'openAnnotation', annotation: second })
    expect(guardNavigation(s, { kind: 'point', date: D1 })).toBe('proceed')
    expect(guardNavigation(s, { kind: 'annotation', id: second.id })).toBe('proceed')
    expect(openPoint(s, D1, [first, second]).dialogue).toMatchObject({ mode: 'edit', editing: first })
  })
})

describe('§10.3 identifiers and authorship (buildAnnotationToSave)', () => {
  const NOW = 1_790_000_000_000
  const ctx = { groupPath: 'org/delivery/alpha', iterationId: '42', now: NOW }

  it('LC30 new annotation: id from the clock, createdAt from the clock, author Current User, trimmed text', () => {
    let s = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    s = lifecycleReducer(s, { kind: 'setText', text: '  scope added late\nby PO \n' })
    s = lifecycleReducer(s, { kind: 'setType', type: 'risk' })
    expect(buildAnnotationToSave(s.dialogue, ctx)).toEqual({
      id: String(NOW),
      groupPath: 'org/delivery/alpha',
      iterationId: '42',
      date: D1,
      author: S.currentUser,
      text: 'scope added late\nby PO',
      type: 'risk',
      createdAt: new Date(NOW).toISOString(),
    })
  })

  it('LC31 new annotation with untouched type is saved with explicit type information', () => {
    const s = lifecycleReducer(openPoint(INITIAL_LIFECYCLE_STATE, D1), { kind: 'setText', text: 'x' })
    expect(buildAnnotationToSave(s.dialogue, ctx)?.type).toBe('information')
  })

  it('LC32 edit keeps id, createdAt and date; author is Current User', () => {
    const a = makeAnnotation({ id: '123', createdAt: '2026-01-01T00:00:00.000Z', date: D1, author: 'Someone' })
    let s = lifecycleReducer(INITIAL_LIFECYCLE_STATE, { kind: 'openAnnotation', annotation: a })
    s = lifecycleReducer(s, { kind: 'setText', text: 'updated' })
    const out = buildAnnotationToSave(s.dialogue, ctx)
    expect(out).toMatchObject({
      id: '123',
      createdAt: '2026-01-01T00:00:00.000Z',
      date: D1,
      author: S.currentUser,
      text: 'updated',
      groupPath: 'org/delivery/alpha',
      iterationId: '42',
    })
  })

  it('LC33 nothing to save: no dialogue, empty trimmed text, or incomplete pair → null', () => {
    const opened = openPoint(INITIAL_LIFECYCLE_STATE, D1)
    expect(buildAnnotationToSave(null, ctx)).toBeNull()
    expect(buildAnnotationToSave(opened.dialogue, ctx)).toBeNull()
    const ws = lifecycleReducer(opened, { kind: 'setText', text: '   ' })
    expect(buildAnnotationToSave(ws.dialogue, ctx)).toBeNull()
    const ok = lifecycleReducer(opened, { kind: 'setText', text: 'x' })
    expect(buildAnnotationToSave(ok.dialogue, { ...ctx, groupPath: null })).toBeNull()
    expect(buildAnnotationToSave(ok.dialogue, { ...ctx, iterationId: '' })).toBeNull()
  })
})
