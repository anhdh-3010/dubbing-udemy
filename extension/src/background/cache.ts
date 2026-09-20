/**
 * The service worker's IndexedDB cache (spec 9).
 *
 * Two hard rules run through every function here:
 *
 * 1. Nothing throws. A cache is an accelerator, not a dependency — a broken
 *    database must cost the viewer a slower lecture, never a silent one.
 *    `withDb` is the only place errors are caught, and it answers with a
 *    miss.
 *
 * 2. No non-IDB `await` inside an open transaction. IndexedDB commits a
 *    transaction as soon as the event loop runs out of pending requests for
 *    it, so awaiting anything else mid-transaction kills it intermittently.
 *    Every function here issues its requests synchronously, awaits the
 *    transaction, and only then reads `request.result`.
 */

export const DB_NAME = 'udemy-dubbing'
export const DB_VERSION = 1

const TRANSLATIONS = 'translations'
const AUDIO = 'audio'

export interface TranslationInput {
  key: string
  vi: string
  srcText: string
  /** Not part of the key — kept so M3b can show and clear a lecture's
   *  cached translations. */
  lectureId: string
}

export interface CachedAudio {
  wav: ArrayBuffer
  duration: number
}

interface TranslationRow {
  vi: string
  srcText: string
  lectureId: string
  lastUsed: number
}

interface AudioRow {
  wav: ArrayBuffer
  duration: number
  bytes: number
  lastUsed: number
}

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Drops every in-memory handle, which is precisely what happens when MV3
 * terminates the service worker. Tests use it to simulate that; nothing in
 * production calls it.
 */
export function resetCacheState(): void {
  dbPromise = null
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function openOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(TRANSLATIONS)) {
        db.createObjectStore(TRANSLATIONS).createIndex('lastUsed', 'lastUsed')
      }
      if (!db.objectStoreNames.contains(AUDIO)) {
        // A two-part index key, not just lastUsed. `openKeyCursor` on it
        // yields key[0] (lastUsed), key[1] (bytes) and the primary key
        // WITHOUT loading the row — so walking least-recently-used first
        // and summing sizes never pulls hundreds of megabytes of audio into
        // memory. Task 3's eviction depends on this shape.
        db.createObjectStore(AUDIO).createIndex('lru', ['lastUsed', 'bytes'])
      }
    }

    req.onsuccess = () => {
      const db = req.result
      // Another tab (or a later DB_VERSION) asking to upgrade blocks
      // forever while this connection stays open. Let go of it; the next
      // call reopens at whatever version is current by then.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }

    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise
  const pending = openOnce()
  dbPromise = pending
  // A failed open must not be memoised forever, or every later call replays
  // the same rejection. Guarded on identity so a retry already in flight is
  // not cleared by an older failure.
  void pending.catch(() => {
    if (dbPromise === pending) dbPromise = null
  })
  return pending
}

async function withDb<T>(fallback: T, fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    return await fn(await openDb())
  } catch (e) {
    console.warn('[udemy-dubbing] cache:', e)
    return fallback
  }
}

/**
 * Bumps `lastUsed` on rows the caller already read, in a `readwrite`
 * transaction of its own.
 *
 * Takes the rows themselves — `[key, row]` pairs — rather than a list of
 * keys to re-fetch. Both callers already hold the row they just read off
 * the store; re-reading it here would mean loading a cache hit's full
 * payload (up to ~200 KB of WAV per audio row) a second time on every
 * single hit, which is the exact hot path this cache exists to make fast.
 * Consequently there is no read phase in this function at all: it never
 * opens a transaction just to `get()` — only the one `readwrite`
 * transaction that writes the new `lastUsed`.
 *
 * Separate from the caller's own read transaction on purpose: it keeps that
 * read transaction read-only and means a failed touch cannot lose the hit
 * that was already served. Never throws — a cache that cannot record a hit
 * still works.
 */
async function touch<T extends object>(
  db: IDBDatabase,
  store: string,
  entries: ReadonlyArray<readonly [string, T]>,
): Promise<void> {
  if (entries.length === 0) return
  try {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    const now = Date.now()
    // Every put is issued here, synchronously, before anything is awaited.
    for (const [key, row] of entries) {
      os.put({ ...row, lastUsed: now }, key)
    }
    await done(tx)
  } catch (e) {
    console.warn('[udemy-dubbing] cache touch:', e)
  }
}

export async function getTranslations(
  keys: readonly string[],
): Promise<Map<string, string>> {
  const empty = new Map<string, string>()
  if (keys.length === 0) return empty

  return withDb(empty, async (db) => {
    const tx = db.transaction(TRANSLATIONS, 'readonly')
    const os = tx.objectStore(TRANSLATIONS)
    // Every get is issued here, synchronously, before anything is awaited.
    const reads = keys.map((key) => os.get(key) as IDBRequest<TranslationRow | undefined>)
    await done(tx)

    const found = new Map<string, string>()
    const hits: Array<[string, TranslationRow]> = []
    for (const [i, req] of reads.entries()) {
      const row = req.result
      if (row === undefined) continue
      found.set(keys[i], row.vi)
      hits.push([keys[i], row])
    }

    await touch(db, TRANSLATIONS, hits)
    return found
  })
}

export async function putTranslations(rows: readonly TranslationInput[]): Promise<void> {
  if (rows.length === 0) return
  await withDb(undefined, async (db) => {
    const tx = db.transaction(TRANSLATIONS, 'readwrite')
    const os = tx.objectStore(TRANSLATIONS)
    const now = Date.now()
    for (const row of rows) {
      const value: TranslationRow = {
        vi: row.vi,
        srcText: row.srcText,
        lectureId: row.lectureId,
        lastUsed: now,
      }
      os.put(value, row.key)
    }
    await done(tx)
  })
}

export async function getAudio(key: string): Promise<CachedAudio | null> {
  return withDb(null, async (db) => {
    const tx = db.transaction(AUDIO, 'readonly')
    const req = tx.objectStore(AUDIO).get(key) as IDBRequest<AudioRow | undefined>
    await done(tx)

    const row = req.result
    if (row === undefined) return null

    await touch(db, AUDIO, [[key, row]])
    return { wav: row.wav, duration: row.duration }
  })
}

export async function putAudio(key: string, wav: ArrayBuffer, duration: number): Promise<void> {
  await withDb(undefined, async (db) => {
    const tx = db.transaction(AUDIO, 'readwrite')
    const value: AudioRow = { wav, duration, bytes: wav.byteLength, lastUsed: Date.now() }
    tx.objectStore(AUDIO).put(value, key)
    await done(tx)
  })
}
