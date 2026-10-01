// Browser storage of annotations and the one-time migration (SPEC §10.4), scoped per §10.2.
// Contract: docs/conformance/annotations.md
//
// Every function takes an optional `storage` argument:
//   - omitted / `undefined` → the default browser storage (`globalThis.localStorage`), resolved lazily on
//     EVERY call and guarded: if it is missing, or merely accessing it throws (e.g. SecurityError), there is
//     no storage;
//   - `null`                → explicitly "no browser storage exists" (§10.4 step 1);
//   - a `StorageLike`       → that object (tests inject fakes).
// No function in this module ever throws: any exception raised by the storage object is swallowed.
// Without storage: `loadAll`/`listFor` return [], `save`/`remove` are silent no-ops.

import { belongsTo, type Annotation } from './model'

/** Current collection key. */
export const ANNOTATIONS_KEY = 'heimdall-annotations.v1'
/** Pre-rename collection key: same shape, adopted once, then always deleted. */
export const PRE_RENAME_KEY = 'burndown-annotations.v2'
/** Oldest key (keyed on iteration number only ⇒ not attributable to a group): always deleted. */
export const OLDEST_KEY = 'burndown-annotations'

/** The subset of the DOM `Storage` interface this module uses. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Storage argument accepted by every function: see the header comment. */
export type StorageArg = StorageLike | null | undefined

/**
 * Resolves the storage argument: `null` → null; a StorageLike → itself; `undefined` → `globalThis.localStorage`
 * if accessing it does not throw and it is an object, else null. Never throws.
 */
export function resolveStorage(storage?: StorageArg): StorageLike | null {
  if (storage !== undefined) return storage
  try {
    const ls: unknown = globalThis.localStorage
    return typeof ls === 'object' && ls !== null ? (ls as StorageLike) : null
  } catch {
    return null // e.g. SecurityError when storage is disabled
  }
}

/** Runs `fn`, swallowing any exception the storage raises. */
function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/**
 * The whole flat collection (every group, every iteration), following the §10.4 read sequence EXACTLY:
 *
 * 1. no storage → [] (and nothing else happens).
 * 2. `removeItem('burndown-annotations')`, unconditionally.
 * 3. `raw = getItem('burndown-annotations.v2')`; if null → go to 4 ('' counts as present: dropped as invalid,
 *    then deleted). Otherwise, in a try/finally whose finally ALWAYS does `removeItem('burndown-annotations.v2')`:
 *      a. if `getItem('heimdall-annotations.v1')` is a non-empty string → stop (current wins; v2 dropped),
 *      b. if `raw` is not valid JSON, or parses to something that is not an array → stop (dropped),
 *      c. otherwise `setItem('heimdall-annotations.v1', raw)` (adopted).
 * 4. `getItem('heimdall-annotations.v1')`: null, invalid JSON, or not an array → []; else the parsed array.
 *    (A corrupted current value is NOT deleted here; the next `save` overwrites it.)
 *
 * Array elements are returned as stored (no per-element validation). Never throws: a storage method that
 * throws makes that step a no-op; if step 4 cannot read, the result is [].
 */
export function loadAll(storage?: StorageArg): Annotation[] {
  const s = resolveStorage(storage)
  if (!s) return []

  attempt(() => s.removeItem(OLDEST_KEY), undefined)

  const raw = attempt(() => s.getItem(PRE_RENAME_KEY), null)
  if (raw !== null) {
    try {
      // Any non-empty current value counts as data, even "[]" or corrupt text (current wins).
      const currentHasData = Boolean(s.getItem(ANNOTATIONS_KEY))
      if (!currentHasData && Array.isArray(JSON.parse(raw))) s.setItem(ANNOTATIONS_KEY, raw)
    } catch {
      // invalid payload or failing storage: v2 is dropped
    } finally {
      attempt(() => s.removeItem(PRE_RENAME_KEY), undefined)
    }
  }

  return attempt(() => {
    const current = s.getItem(ANNOTATIONS_KEY)
    const parsed: unknown = current === null ? null : JSON.parse(current)
    return Array.isArray(parsed) ? (parsed as Annotation[]) : []
  }, [])
}

/** Matches on identifier AND pair (§10.2). Elements are unvalidated, hence the null guard. */
function isEntry(a: Annotation | null, id: string, groupPath: string, iterationId: string): boolean {
  return a?.id === id && a.groupPath === groupPath && a.iterationId === iterationId
}

function write(s: StorageLike, list: Annotation[]): void {
  attempt(() => s.setItem(ANNOTATIONS_KEY, JSON.stringify(list)), undefined)
}

/**
 * Annotations of exactly one (groupPath, iterationId) pair, in stored (= save) order. Reads through
 * `loadAll` (so the migration runs). Returns [] when `groupPath` or `iterationId` is null/undefined/'' —
 * never "all" (§10.2).
 */
export function listFor(
  groupPath: string | null | undefined,
  iterationId: string | null | undefined,
  storage?: StorageArg,
): Annotation[] {
  return loadAll(storage).filter((a) => a != null && belongsTo(a, groupPath, iterationId))
}

/**
 * Upsert. Reads the collection through `loadAll` (so the migration runs FIRST and pre-rename data is never
 * lost), then replaces IN PLACE the entry whose `id` AND `groupPath` AND `iterationId` all equal the given
 * annotation's, or appends it at the end if none matches; then writes the whole collection back to
 * `heimdall-annotations.v1` as a JSON array. Order of all other entries is preserved.
 * A corrupted collection reads as [] and is therefore replaced. Silent no-op without storage. Never throws.
 */
export function save(annotation: Annotation, storage?: StorageArg): void {
  const s = resolveStorage(storage)
  if (!s) return
  const list = loadAll(s)
  const { id, groupPath, iterationId } = annotation
  const index = list.findIndex((a) => isEntry(a, id, groupPath, iterationId))
  if (index >= 0) list[index] = annotation
  else list.push(annotation)
  write(s, list)
}

/**
 * Removes the entry whose `id` AND `groupPath` AND `iterationId` match (entries of other pairs with the same id
 * are untouched), then writes the collection back. Removing something absent never fails. Silent no-op
 * without storage. Never throws.
 */
export function remove(
  id: string,
  groupPath: string,
  iterationId: string,
  storage?: StorageArg,
): void {
  const s = resolveStorage(storage)
  if (!s) return
  write(s, loadAll(s).filter((a) => !isEntry(a, id, groupPath, iterationId)))
}
