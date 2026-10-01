import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listFor, loadAll, remove, save } from './storage'
import { MemoryStorage, makeAnnotation, throwingStorage } from './testStorage'

const CURRENT = 'heimdall-annotations.v1'
const V2 = 'burndown-annotations.v2'
const OLDEST = 'burndown-annotations'

const A = 'org/delivery/alpha'
const B = 'org/delivery/beta'

describe('§10.4 read sequence (loadAll)', () => {
  it('ST01 step 2: deletes the oldest key unconditionally, even when nothing else exists', () => {
    const s = new MemoryStorage({ [OLDEST]: '[{"iteration":42,"text":"old"}]' })
    expect(loadAll(s)).toEqual([])
    expect(s.data.has(OLDEST)).toBe(false)
    expect(s.calls).toContain(`remove ${OLDEST}`)
  })

  it('ST02 step 2: deletes the oldest key even when the current key has data, and never adopts it', () => {
    const a = makeAnnotation()
    const s = new MemoryStorage({ [OLDEST]: JSON.stringify([makeAnnotation()]), [CURRENT]: JSON.stringify([a]) })
    expect(loadAll(s)).toEqual([a])
    expect(s.data.has(OLDEST)).toBe(false)
  })

  it('ST03 step 2 happens before step 3 and step 4 (order of operations)', () => {
    const s = new MemoryStorage({ [OLDEST]: '[]', [V2]: JSON.stringify([makeAnnotation()]) })
    loadAll(s)
    const removeOldest = s.calls.indexOf(`remove ${OLDEST}`)
    const readV2 = s.calls.indexOf(`get ${V2}`)
    expect(removeOldest).toBeGreaterThanOrEqual(0)
    expect(readV2).toBeGreaterThan(removeOldest)
    // the final read of the current key comes after the v2 key was deleted
    expect(s.calls.lastIndexOf(`get ${CURRENT}`)).toBeGreaterThan(s.calls.indexOf(`remove ${V2}`))
  })

  it('ST04 step 3: v2 is adopted into the current key when the current key is absent', () => {
    const a1 = makeAnnotation()
    const a2 = makeAnnotation({ groupPath: B })
    const s = new MemoryStorage({ [V2]: JSON.stringify([a1, a2]) })
    expect(loadAll(s)).toEqual([a1, a2])
    expect(s.json(CURRENT)).toEqual([a1, a2])
    expect(s.data.has(V2)).toBe(false)
  })

  it('ST05 step 3: v2 is adopted only once (deleted after adoption; later reads do not re-adopt)', () => {
    const a1 = makeAnnotation()
    const s = new MemoryStorage({ [V2]: JSON.stringify([a1]) })
    loadAll(s)
    s.data.set(CURRENT, JSON.stringify([])) // user deleted everything afterwards
    expect(loadAll(s)).toEqual([])
  })

  it('ST06 step 3: current wins — v2 is dropped (and deleted) when the current key already has data', () => {
    const cur = makeAnnotation({ text: 'current' })
    const old = makeAnnotation({ text: 'pre-rename' })
    const s = new MemoryStorage({ [CURRENT]: JSON.stringify([cur]), [V2]: JSON.stringify([old]) })
    expect(loadAll(s)).toEqual([cur])
    expect(s.data.has(V2)).toBe(false)
    expect(s.json(CURRENT)).toEqual([cur])
  })

  it('ST07 step 3: an existing current value of "[]" counts as data — v2 is dropped, not adopted', () => {
    const s = new MemoryStorage({ [CURRENT]: '[]', [V2]: JSON.stringify([makeAnnotation()]) })
    expect(loadAll(s)).toEqual([])
    expect(s.data.has(V2)).toBe(false)
  })

  it('ST08 step 3: v2 with invalid JSON is dropped AND deleted; result is []', () => {
    const s = new MemoryStorage({ [V2]: '{not json' })
    expect(() => loadAll(s)).not.toThrow()
    expect(loadAll(new MemoryStorage({ [V2]: '{not json' }))).toEqual([])
    expect(s.data.has(V2)).toBe(false)
    expect(s.data.has(CURRENT)).toBe(false)
  })

  it('ST09 step 3: v2 whose payload is valid JSON but not an array is dropped AND deleted', () => {
    for (const payload of ['{"a":1}', '"text"', '42', 'null', 'true']) {
      const s = new MemoryStorage({ [V2]: payload })
      expect(loadAll(s)).toEqual([])
      expect(s.data.has(V2)).toBe(false)
      expect(s.data.has(CURRENT)).toBe(false)
    }
  })

  it('ST10 step 3: invalid v2 does not disturb existing current data', () => {
    const cur = makeAnnotation()
    const s = new MemoryStorage({ [CURRENT]: JSON.stringify([cur]), [V2]: '{broken' })
    expect(loadAll(s)).toEqual([cur])
    expect(s.data.has(V2)).toBe(false)
  })

  it('ST11 step 3: absent v2 → nothing written, current read as-is', () => {
    const cur = makeAnnotation()
    const s = new MemoryStorage({ [CURRENT]: JSON.stringify([cur]) })
    expect(loadAll(s)).toEqual([cur])
    expect(s.calls.filter((c) => c.startsWith('set '))).toEqual([])
  })

  it('ST12 step 4: current key with invalid JSON → []', () => {
    expect(loadAll(new MemoryStorage({ [CURRENT]: '[{oops' }))).toEqual([])
  })

  it('ST13 step 4: current key that is valid JSON but not an array → []', () => {
    for (const payload of ['{"id":"1"}', '"x"', '7', 'null']) {
      expect(loadAll(new MemoryStorage({ [CURRENT]: payload }))).toEqual([])
    }
  })

  it('ST14 step 4: empty storage → []', () => {
    expect(loadAll(new MemoryStorage())).toEqual([])
  })

  it('ST15 corrupted current content degrades to [] and the next save replaces it', () => {
    const s = new MemoryStorage({ [CURRENT]: '###corrupt###' })
    expect(loadAll(s)).toEqual([])
    const a = makeAnnotation()
    save(a, s)
    expect(s.json(CURRENT)).toEqual([a])
    expect(loadAll(s)).toEqual([a])
  })

  it('ST16 save runs the migration first: pre-rename data is kept when the first operation is a save', () => {
    const old = makeAnnotation({ text: 'pre-rename' })
    const s = new MemoryStorage({ [V2]: JSON.stringify([old]) })
    const fresh = makeAnnotation({ text: 'new' })
    save(fresh, s)
    expect(s.json(CURRENT)).toEqual([old, fresh])
    expect(s.data.has(V2)).toBe(false)
  })

  it('ST17 listFor runs the migration (reads through loadAll)', () => {
    const old = makeAnnotation({ groupPath: A, iterationId: '42' })
    const s = new MemoryStorage({ [V2]: JSON.stringify([old]), [OLDEST]: '[]' })
    expect(listFor(A, '42', s)).toEqual([old])
    expect(s.data.has(V2)).toBe(false)
    expect(s.data.has(OLDEST)).toBe(false)
  })

  it('ST18 step 3: an empty-string v2 value counts as present — deleted, nothing adopted', () => {
    const s = new MemoryStorage({ [V2]: '' })
    expect(loadAll(s)).toEqual([])
    expect(s.data.has(V2)).toBe(false)
    expect(s.data.has(CURRENT)).toBe(false)
  })

  it('ST19 step 3: v2 is deleted even when the adoption write itself fails (setItem throws)', () => {
    const s = new MemoryStorage({ [V2]: JSON.stringify([makeAnnotation()]) })
    s.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => loadAll(s)).not.toThrow()
    expect(s.data.has(V2)).toBe(false)
    expect(s.data.has(CURRENT)).toBe(false)
  })
})

describe('§10.4 no browser storage', () => {
  const ann = makeAnnotation()

  it('ST20 storage = null: loadAll/listFor return [], save/remove are silent no-ops', () => {
    expect(loadAll(null)).toEqual([])
    expect(listFor(A, '42', null)).toEqual([])
    expect(() => save(ann, null)).not.toThrow()
    expect(() => remove(ann.id, A, '42', null)).not.toThrow()
  })

  it('ST21 storage whose methods all throw: nothing throws, reads give []', () => {
    expect(() => loadAll(throwingStorage)).not.toThrow()
    expect(loadAll(throwingStorage)).toEqual([])
    expect(listFor(A, '42', throwingStorage)).toEqual([])
    expect(() => save(ann, throwingStorage)).not.toThrow()
    expect(() => remove(ann.id, A, '42', throwingStorage)).not.toThrow()
  })

  it('ST22 only setItem throws (quota exceeded): save does not throw', () => {
    const s = new MemoryStorage()
    s.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => save(ann, s)).not.toThrow()
    expect(() => remove(ann.id, A, '42', s)).not.toThrow()
  })

  describe('default storage (argument omitted)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('ST23 globalThis.localStorage undefined: every operation is a silent no-op / []', () => {
      vi.stubGlobal('localStorage', undefined)
      expect(loadAll()).toEqual([])
      expect(listFor(A, '42')).toEqual([])
      expect(() => save(ann)).not.toThrow()
      expect(() => remove(ann.id, A, '42')).not.toThrow()
    })

    it('ST24 accessing globalThis.localStorage throws: every operation is a silent no-op / []', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError')
        },
      })
      try {
        expect(loadAll()).toEqual([])
        expect(listFor(A, '42')).toEqual([])
        expect(() => save(ann)).not.toThrow()
        expect(() => remove(ann.id, A, '42')).not.toThrow()
      } finally {
        if (original) Object.defineProperty(globalThis, 'localStorage', original)
        else delete (globalThis as { localStorage?: unknown }).localStorage
      }
    })
  })
})

describe('default storage is the browser localStorage', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('ST25 omitted storage argument reads/writes globalThis.localStorage under heimdall-annotations.v1', () => {
    const a = makeAnnotation()
    save(a)
    expect(JSON.parse(globalThis.localStorage.getItem(CURRENT) as string)).toEqual([a])
    expect(listFor(a.groupPath, a.iterationId)).toEqual([a])
    globalThis.localStorage.clear()
  })
})

describe('§10.4 write sequence', () => {
  it('ST30 save appends new annotations in save order; whole flat collection written as JSON array', () => {
    const s = new MemoryStorage()
    const a1 = makeAnnotation({ groupPath: A })
    const b1 = makeAnnotation({ groupPath: B })
    const a2 = makeAnnotation({ groupPath: A })
    save(a1, s)
    save(b1, s)
    save(a2, s)
    expect(s.json(CURRENT)).toEqual([a1, b1, a2])
    expect(listFor(A, '42', s)).toEqual([a1, a2])
  })

  it('ST31 save replaces in place (same id AND pair) and keeps list order', () => {
    const s = new MemoryStorage()
    const a1 = makeAnnotation()
    const a2 = makeAnnotation()
    const a3 = makeAnnotation()
    save(a1, s)
    save(a2, s)
    save(a3, s)
    const edited = { ...a2, text: 'edited', type: 'risk' as const }
    save(edited, s)
    expect(s.json(CURRENT)).toEqual([a1, edited, a3])
  })

  it('ST32 same id in a different iteration of the same group is appended, not replaced', () => {
    const s = new MemoryStorage()
    const x42 = makeAnnotation({ id: 'same', iterationId: '42' })
    const x43 = makeAnnotation({ id: 'same', iterationId: '43' })
    save(x42, s)
    save(x43, s)
    expect(s.json(CURRENT)).toEqual([x42, x43])
  })

  it('ST33 remove filters out the matching entry and keeps the order of the rest', () => {
    const s = new MemoryStorage()
    const a1 = makeAnnotation()
    const a2 = makeAnnotation()
    const a3 = makeAnnotation()
    for (const a of [a1, a2, a3]) save(a, s)
    remove(a2.id, a2.groupPath, a2.iterationId, s)
    expect(s.json(CURRENT)).toEqual([a1, a3])
  })

  it('ST34 removing an absent id never fails and changes nothing', () => {
    const s = new MemoryStorage()
    const a1 = makeAnnotation()
    save(a1, s)
    expect(() => remove('does-not-exist', A, '42', s)).not.toThrow()
    expect(loadAll(s)).toEqual([a1])
    expect(() => remove('x', A, '42', new MemoryStorage())).not.toThrow()
  })

  it('ST35 remove on corrupted content does not throw', () => {
    const s = new MemoryStorage({ [CURRENT]: 'garbage' })
    expect(() => remove('x', A, '42', s)).not.toThrow()
  })

  it('ST36 remove matches the iteration too: same id and group, other iteration survives', () => {
    const s = new MemoryStorage()
    const x42 = makeAnnotation({ id: 'same', groupPath: A, iterationId: '42' })
    const x43 = makeAnnotation({ id: 'same', groupPath: A, iterationId: '43' })
    save(x42, s)
    save(x43, s)
    remove('same', A, '42', s)
    expect(s.json(CURRENT)).toEqual([x43])
  })
})

describe('§10.2 scoping (listFor)', () => {
  it('ST40 listFor returns [] — never "all" — when the group or the iteration is missing or empty', () => {
    const s = new MemoryStorage()
    save(makeAnnotation({ groupPath: A, iterationId: '42' }), s)
    save(makeAnnotation({ groupPath: B, iterationId: '42' }), s)
    expect(listFor(null, '42', s)).toEqual([])
    expect(listFor(undefined, '42', s)).toEqual([])
    expect(listFor('', '42', s)).toEqual([])
    expect(listFor(A, null, s)).toEqual([])
    expect(listFor(A, undefined, s)).toEqual([])
    expect(listFor(A, '', s)).toEqual([])
    expect(listFor(null, null, s)).toEqual([])
  })

  it('ST41 listFor matches the exact pair (other iterations of the same group excluded)', () => {
    const s = new MemoryStorage()
    const a42 = makeAnnotation({ groupPath: A, iterationId: '42' })
    const a43 = makeAnnotation({ groupPath: A, iterationId: '43' })
    save(a42, s)
    save(a43, s)
    expect(listFor(A, '42', s)).toEqual([a42])
    expect(listFor(A, '43', s)).toEqual([a43])
  })
})

describe('§15.8 annotation scoping (acceptance)', () => {
  it('AC1 group A / 42 and group B / 42: viewing A shows only A’s', () => {
    const s = new MemoryStorage()
    const a = makeAnnotation({ groupPath: A, iterationId: '42', text: 'A note' })
    const b = makeAnnotation({ groupPath: B, iterationId: '42', text: 'B note' })
    save(a, s)
    save(b, s)
    expect(listFor(A, '42', s)).toEqual([a])
    expect(listFor(B, '42', s)).toEqual([b])
  })

  it('AC2 deleting A’s leaves B’s untouched (even when they share an identifier)', () => {
    const s = new MemoryStorage()
    const a = makeAnnotation({ id: '1700000000000', groupPath: A, iterationId: '42' })
    const b = makeAnnotation({ id: '1700000000000', groupPath: B, iterationId: '42' })
    save(a, s)
    save(b, s)
    remove('1700000000000', A, '42', s)
    expect(listFor(A, '42', s)).toEqual([])
    expect(listFor(B, '42', s)).toEqual([b])
  })

  it('AC3 two annotations sharing an identifier in different groups do not overwrite each other', () => {
    const s = new MemoryStorage()
    const a = makeAnnotation({ id: 'same', groupPath: A, iterationId: '42', text: 'A' })
    const b = makeAnnotation({ id: 'same', groupPath: B, iterationId: '42', text: 'B' })
    save(a, s)
    save(b, s)
    expect(s.json(CURRENT)).toEqual([a, b])
    const a2 = { ...a, text: 'A edited' }
    save(a2, s)
    expect(listFor(A, '42', s)).toEqual([a2])
    expect(listFor(B, '42', s)).toEqual([b])
  })
})
