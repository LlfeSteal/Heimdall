import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { S } from '../strings'
import type { Annotation } from './model'
import { MemoryStorage, makeAnnotation, throwingStorage } from './testStorage'
import { useAnnotations, type UseAnnotationsOptions } from './useAnnotations'

const CURRENT = 'heimdall-annotations.v1'
const A = 'org/delivery/alpha'
const B = 'org/delivery/beta'
const D1 = '2026-09-10'
const D2 = '2026-09-11'
const T0 = 1_790_000_000_000

function seed(...list: Annotation[]): MemoryStorage {
  return new MemoryStorage({ [CURRENT]: JSON.stringify(list) })
}

function setup(overrides: Partial<UseAnnotationsOptions> = {}) {
  const storage = (overrides.storage as MemoryStorage | undefined) ?? new MemoryStorage()
  let clock = T0
  const now = vi.fn(() => clock)
  const confirm = vi.fn((_msg: string) => true)
  const initialProps: UseAnnotationsOptions = {
    groupPath: A,
    iterationId: '42',
    storage,
    confirm,
    now,
    ...overrides,
  }
  const hook = renderHook((props: UseAnnotationsOptions) => useAnnotations(props), { initialProps })
  return {
    ...hook,
    storage,
    confirm,
    now,
    props: initialProps,
    tick(ms: number) {
      clock += ms
    },
  }
}

describe('useAnnotations — list & scoping', () => {
  it('HK01 lists only the current (group, iteration) pair, in stored order', () => {
    const a1 = makeAnnotation({ groupPath: A, iterationId: '42' })
    const b1 = makeAnnotation({ groupPath: B, iterationId: '42' })
    const a2 = makeAnnotation({ groupPath: A, iterationId: '42' })
    const a43 = makeAnnotation({ groupPath: A, iterationId: '43' })
    const { result } = setup({ storage: seed(a1, b1, a2, a43) })
    expect(result.current.annotations).toEqual([a1, a2])
  })

  it('HK02 no iteration or no group → empty list (never "all")', () => {
    const storage = seed(makeAnnotation({ groupPath: A, iterationId: '42' }))
    expect(setup({ storage, iterationId: null }).result.current.annotations).toEqual([])
    expect(setup({ storage, groupPath: null }).result.current.annotations).toEqual([])
    expect(setup({ storage, groupPath: '', iterationId: '' }).result.current.annotations).toEqual([])
  })

  it('HK03 §15.8 via the hook: A/42 and B/42 each see only their own; deleting A’s keeps B’s', () => {
    const storage = new MemoryStorage()
    const hookA = setup({ storage, groupPath: A })
    act(() => hookA.result.current.clickPoint(D1))
    act(() => hookA.result.current.setText('A note'))
    act(() => hookA.result.current.save())

    const hookB = setup({ storage, groupPath: B })
    act(() => hookB.result.current.clickPoint(D1))
    act(() => hookB.result.current.setText('B note'))
    act(() => hookB.result.current.save())

    hookA.rerender({ ...hookA.props }) // A re-renders; list must still be A's only
    expect(hookA.result.current.annotations.map((a) => a.text)).toEqual(['A note'])
    expect(hookB.result.current.annotations.map((a) => a.text)).toEqual(['B note'])

    // both were created at the same clock instant ⇒ they share an identifier (ledger #14)
    expect(hookA.result.current.annotations[0].id).toBe(hookB.result.current.annotations[0].id)

    act(() => hookA.result.current.remove(hookA.result.current.annotations[0].id))
    expect(hookA.result.current.annotations).toEqual([])
    hookB.rerender({ ...hookB.props })
    expect(hookB.result.current.annotations.map((a) => a.text)).toEqual(['B note'])
    expect((storage.json(CURRENT) as Annotation[]).map((a) => a.text)).toEqual(['B note'])
  })

  it('HK04 list order is save order; editing does not re-sort', () => {
    const { result, tick } = setup()
    for (const [date, text] of [
      [D2, 'second date first'],
      [D1, 'first date second'],
    ]) {
      act(() => result.current.clickPoint(date))
      act(() => result.current.setText(text))
      act(() => result.current.save())
      tick(1000)
    }
    expect(result.current.annotations.map((a) => a.text)).toEqual(['second date first', 'first date second'])
    act(() => result.current.editFromList(result.current.annotations[0].id))
    act(() => result.current.setText('edited'))
    act(() => result.current.save())
    expect(result.current.annotations.map((a) => a.text)).toEqual(['edited', 'first date second'])
  })
})

describe('useAnnotations — opening the dialogue', () => {
  it('HK10 initial state: nothing selected, no dialogue, not dirty', () => {
    const { result } = setup()
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.dialogue).toBeNull()
    expect(result.current.dirty).toBe(false)
    expect(result.current.canSave).toBe(false)
  })

  it('HK11 clicking an empty point opens Add mode, empty, type information, not dirty', () => {
    const { result } = setup()
    act(() => result.current.clickPoint(D1))
    expect(result.current.selectedDate).toBe(D1)
    expect(result.current.dialogue).toEqual({ mode: 'add', date: D1, text: '', type: 'information', annotationId: null })
    expect(result.current.dirty).toBe(false)
  })

  it('HK12 clicking a point pre-fills with the FIRST annotation on that date (Edit mode), not dirty', () => {
    const first = makeAnnotation({ date: D1, text: 'first', type: 'risk' })
    const second = makeAnnotation({ date: D1, text: 'second' })
    const { result } = setup({ storage: seed(makeAnnotation({ date: D2 }), first, second) })
    act(() => result.current.clickPoint(D1))
    expect(result.current.dialogue).toEqual({ mode: 'edit', date: D1, text: 'first', type: 'risk', annotationId: first.id })
    expect(result.current.dirty).toBe(false)
  })

  it('HK13 editFromList opens that exact annotation (even when it is not the first of its date)', () => {
    const first = makeAnnotation({ date: D1, text: 'first' })
    const second = makeAnnotation({ date: D1, text: 'second' })
    const { result } = setup({ storage: seed(first, second) })
    act(() => result.current.editFromList(second.id))
    expect(result.current.selectedDate).toBe(D1)
    expect(result.current.dialogue).toMatchObject({ mode: 'edit', text: 'second', annotationId: second.id })
  })

  it('HK14 editFromList with an unknown id changes nothing', () => {
    const { result } = setup()
    act(() => result.current.editFromList('nope'))
    expect(result.current.dialogue).toBeNull()
    expect(result.current.selectedDate).toBeNull()
  })
})

describe('useAnnotations — dirty tracking', () => {
  it('HK20 typing marks dirty; whitespace-only typing does not', () => {
    const { result } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('   \n  '))
    expect(result.current.dirty).toBe(false)
    expect(result.current.dialogue?.text).toBe('   \n  ')
    act(() => result.current.setText('x'))
    expect(result.current.dirty).toBe(true)
  })

  it('HK21 changing the type marks dirty; reverting it is clean', () => {
    const { result } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setType('risk'))
    expect(result.current.dirty).toBe(true)
    act(() => result.current.setType('information'))
    expect(result.current.dirty).toBe(false)
  })

  it('HK22 edit: re-typing the same text with extra surrounding whitespace is not dirty', () => {
    const a = makeAnnotation({ date: D1, text: 'scope added' })
    const { result } = setup({ storage: seed(a) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('scope added  \n'))
    expect(result.current.dirty).toBe(false)
  })
})

describe('useAnnotations — unsaved-changes guard (§3.5)', () => {
  it('HK30 dirty + click another point: asks S.unsavedPrompt; accepting opens the new point', () => {
    const onD2 = makeAnnotation({ date: D2, text: 'there' })
    const { result, confirm } = setup({ storage: seed(onD2) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('draft'))
    confirm.mockReturnValueOnce(true)
    act(() => result.current.clickPoint(D2))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith(S.unsavedPrompt)
    expect(result.current.selectedDate).toBe(D2)
    expect(result.current.dialogue).toMatchObject({ mode: 'edit', text: 'there', annotationId: onD2.id })
    expect(result.current.dirty).toBe(false)
  })

  it('HK31 dirty + click another point + DECLINE: selection, dialogue and text are exactly unchanged', () => {
    const storage = seed(makeAnnotation({ date: D2 }))
    const { result, confirm } = setup({ storage })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setType('risk'))
    act(() => result.current.setText('draft  text'))
    const before = {
      selectedDate: result.current.selectedDate,
      dialogue: result.current.dialogue,
      dirty: result.current.dirty,
      annotations: result.current.annotations,
    }
    const raw = storage.data.get(CURRENT)
    confirm.mockReturnValueOnce(false)
    act(() => result.current.clickPoint(D2))
    expect(confirm).toHaveBeenCalledWith(S.unsavedPrompt)
    expect({
      selectedDate: result.current.selectedDate,
      dialogue: result.current.dialogue,
      dirty: result.current.dirty,
      annotations: result.current.annotations,
    }).toEqual(before)
    expect(storage.data.get(CURRENT)).toBe(raw)
  })

  it('HK32 dirty + Edit on another annotation: accept opens it, decline changes nothing', () => {
    const other = makeAnnotation({ date: D2, text: 'other' })
    const { result, confirm } = setup({ storage: seed(other) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('draft'))
    const before = { selectedDate: result.current.selectedDate, dialogue: result.current.dialogue }

    confirm.mockReturnValueOnce(false)
    act(() => result.current.editFromList(other.id))
    expect(confirm).toHaveBeenLastCalledWith(S.unsavedPrompt)
    expect({ selectedDate: result.current.selectedDate, dialogue: result.current.dialogue }).toEqual(before)

    confirm.mockReturnValueOnce(true)
    act(() => result.current.editFromList(other.id))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(result.current.selectedDate).toBe(D2)
    expect(result.current.dialogue).toMatchObject({ mode: 'edit', text: 'other', annotationId: other.id })
  })

  it('HK33 a clean dialogue (or no dialogue) never prompts', () => {
    const a = makeAnnotation({ date: D2 })
    const { result, confirm } = setup({ storage: seed(a) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('   ')) // whitespace only: still clean
    act(() => result.current.clickPoint(D2))
    act(() => result.current.editFromList(a.id))
    act(() => result.current.cancel())
    act(() => result.current.clickPoint(D1))
    expect(confirm).not.toHaveBeenCalled()
    expect(result.current.selectedDate).toBe(D1)
  })

  it('HK34 dirty + click the SAME point / Edit the SAME annotation: no prompt, unsaved text kept', () => {
    const a = makeAnnotation({ date: D1, text: 'orig' })
    const { result, confirm } = setup({ storage: seed(a) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('changed'))
    act(() => result.current.clickPoint(D1))
    act(() => result.current.editFromList(a.id))
    expect(confirm).not.toHaveBeenCalled()
    expect(result.current.dialogue?.text).toBe('changed')
    expect(result.current.dirty).toBe(true)
  })

  it('HK35 clean: Edit the 2nd annotation of a date, then click that point → the FIRST annotation opens', () => {
    const first = makeAnnotation({ date: D1, text: 'first' })
    const second = makeAnnotation({ date: D1, text: 'second' })
    const { result, confirm } = setup({ storage: seed(first, second) })
    act(() => result.current.editFromList(second.id))
    expect(result.current.dialogue).toMatchObject({ annotationId: second.id })
    act(() => result.current.clickPoint(D1))
    expect(confirm).not.toHaveBeenCalled()
    expect(result.current.selectedDate).toBe(D1)
    expect(result.current.dialogue).toMatchObject({ mode: 'edit', text: 'first', annotationId: first.id })
  })
})

describe('useAnnotations — save / cancel / delete', () => {
  it('HK40 save (add) writes through: new id + createdAt from the injected clock, author Current User', () => {
    const { result, storage } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setType('risk'))
    act(() => result.current.setText('  incident on prod \n'))
    expect(result.current.canSave).toBe(true)
    act(() => result.current.save())
    const expected: Annotation = {
      id: String(T0),
      groupPath: A,
      iterationId: '42',
      date: D1,
      author: S.currentUser,
      text: 'incident on prod',
      type: 'risk',
      createdAt: new Date(T0).toISOString(),
    }
    expect(storage.json(CURRENT)).toEqual([expected])
    expect(result.current.annotations).toEqual([expected])
    expect(result.current.dialogue).toBeNull()
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.dirty).toBe(false)
  })

  it('HK41 save (edit) keeps id and createdAt, updates text/type, replaces in place', () => {
    const before = makeAnnotation({ date: D2, text: 'before' })
    const a = makeAnnotation({ id: '111', createdAt: '2026-01-01T00:00:00.000Z', date: D1, text: 'old', type: 'information' })
    const after = makeAnnotation({ date: D2, text: 'after' })
    const { result, storage, tick } = setup({ storage: seed(before, a, after) })
    tick(60_000)
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('new'))
    act(() => result.current.setType('risk'))
    act(() => result.current.save())
    const stored = storage.json(CURRENT) as Annotation[]
    expect(stored).toHaveLength(3)
    expect(stored[0]).toEqual(before)
    expect(stored[1]).toMatchObject({ id: '111', createdAt: '2026-01-01T00:00:00.000Z', text: 'new', type: 'risk', date: D1 })
    expect(stored[2]).toEqual(after)
  })

  it('HK42 save re-reads from storage (storage is the source of truth, not optimistic state)', () => {
    const { result, storage } = setup()
    // someone else (another tab) writes behind the hook's back
    const sneaky = makeAnnotation({ groupPath: A, iterationId: '42', text: 'written elsewhere' })
    storage.data.set(CURRENT, JSON.stringify([sneaky]))
    expect(result.current.annotations).toEqual([]) // not yet re-read
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('mine'))
    act(() => result.current.save())
    expect(result.current.annotations.map((a) => a.text)).toEqual(['written elsewhere', 'mine'])
  })

  it('HK43 when the write is silently lost, the list reflects storage (nothing shown)', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => {
      /* quota exceeded: silently dropped */
    }
    const { result } = setup({ storage })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('lost'))
    act(() => result.current.save())
    expect(result.current.annotations).toEqual([])
  })

  it('HK44 save with empty / whitespace-only text is ignored: nothing written, dialogue stays open', () => {
    const { result, storage } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.save())
    act(() => result.current.setText('  \n '))
    expect(result.current.canSave).toBe(false)
    act(() => result.current.save())
    expect(storage.data.has(CURRENT)).toBe(false)
    expect(result.current.dialogue).toMatchObject({ mode: 'add', date: D1 })
    expect(result.current.selectedDate).toBe(D1)
  })

  it('HK45 cancel closes the dialogue, clears selection, discards text, writes nothing', () => {
    const { result, storage } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('draft'))
    act(() => result.current.cancel())
    expect(result.current.dialogue).toBeNull()
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.dirty).toBe(false)
    expect(storage.data.has(CURRENT)).toBe(false)
    act(() => result.current.clickPoint(D1))
    expect(result.current.dialogue?.text).toBe('')
  })

  it('HK46 delete removes within the current pair and re-reads (proved by a write behind the hook)', () => {
    const a = makeAnnotation({ id: 'same', groupPath: A, iterationId: '42', text: 'A' })
    const b = makeAnnotation({ id: 'same', groupPath: B, iterationId: '42', text: 'B' })
    const storage = seed(a, b)
    const { result, confirm } = setup({ storage })
    const sneaky = makeAnnotation({ groupPath: A, iterationId: '42', text: 'written elsewhere' })
    storage.data.set(CURRENT, JSON.stringify([a, b, sneaky]))
    act(() => result.current.remove('same'))
    expect(result.current.annotations).toEqual([sneaky])
    expect(storage.json(CURRENT)).toEqual([b, sneaky])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('HK47 deleting a missing id is harmless', () => {
    const a = makeAnnotation()
    const { result } = setup({ storage: seed(a) })
    expect(() => act(() => result.current.remove('missing'))).not.toThrow()
    expect(result.current.annotations).toEqual([a])
  })

  it('HK48 deleting the annotation open in the dialogue closes it; deleting another leaves the dialogue alone', () => {
    const a = makeAnnotation({ date: D1, text: 'a' })
    const other = makeAnnotation({ date: D2, text: 'other' })
    const { result } = setup({ storage: seed(a, other) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('a, edited'))
    act(() => result.current.remove(other.id))
    expect(result.current.dialogue).toMatchObject({ annotationId: a.id, text: 'a, edited' })
    act(() => result.current.remove(a.id))
    expect(result.current.dialogue).toBeNull()
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.annotations).toEqual([])
  })

  it('HK49 consecutive new annotations get ids from the clock at save time', () => {
    const { result, tick } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('one'))
    act(() => result.current.save())
    tick(5)
    act(() => result.current.clickPoint(D2))
    act(() => result.current.setText('two'))
    act(() => result.current.save())
    expect(result.current.annotations.map((a) => a.id)).toEqual([String(T0), String(T0 + 5)])
  })
})

describe('useAnnotations — group / iteration changes', () => {
  it('HK50 selecting another iteration clears selection and closes the dialogue without asking; list re-read', () => {
    const a43 = makeAnnotation({ groupPath: A, iterationId: '43' })
    const { result, rerender, props, confirm } = setup({ storage: seed(a43) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('unsaved'))
    rerender({ ...props, iterationId: '43' })
    expect(confirm).not.toHaveBeenCalled()
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.dialogue).toBeNull()
    expect(result.current.dirty).toBe(false)
    expect(result.current.annotations).toEqual([a43])
  })

  it('HK51 opening another group clears selection and dialogue; list is that group’s', () => {
    const b = makeAnnotation({ groupPath: B, iterationId: '42' })
    const { result, rerender, props } = setup({ storage: seed(makeAnnotation({ groupPath: A }), b) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('unsaved'))
    rerender({ ...props, groupPath: B })
    expect(result.current.dialogue).toBeNull()
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.annotations).toEqual([b])
  })

  it('HK52 leaving the group (back to list) clears everything', () => {
    const { result, rerender, props } = setup({ storage: seed(makeAnnotation()) })
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('unsaved'))
    rerender({ ...props, groupPath: null, iterationId: null })
    expect(result.current.dialogue).toBeNull()
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.annotations).toEqual([])
    expect(result.current.dirty).toBe(false)
  })

  it('HK53 re-entering the same pair after leaving starts clean', () => {
    const { result, rerender, props } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('unsaved'))
    rerender({ ...props, iterationId: null })
    rerender({ ...props })
    expect(result.current.dialogue).toBeNull()
  })

  it('HK54 an unrelated re-render (same pair) keeps the dialogue and its text', () => {
    const { result, rerender, props } = setup()
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('keep me'))
    rerender({ ...props })
    expect(result.current.dialogue?.text).toBe('keep me')
  })
})

describe('useAnnotations — no browser storage', () => {
  it('HK60 storage null: the full flow never throws and the list stays empty', () => {
    const { result } = setup({ storage: null })
    expect(result.current.annotations).toEqual([])
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('x'))
    expect(() => act(() => result.current.save())).not.toThrow()
    expect(result.current.annotations).toEqual([])
    expect(result.current.dialogue).toBeNull()
    expect(() => act(() => result.current.remove('x'))).not.toThrow()
  })

  it('HK61 storage whose methods throw: the full flow never throws', () => {
    const { result } = setup({ storage: throwingStorage })
    expect(result.current.annotations).toEqual([])
    act(() => result.current.clickPoint(D1))
    act(() => result.current.setText('x'))
    expect(() => act(() => result.current.save())).not.toThrow()
    expect(() => act(() => result.current.remove('x'))).not.toThrow()
    expect(result.current.annotations).toEqual([])
  })
})
