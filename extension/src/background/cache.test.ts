// Must be the first import: it installs `indexedDB` and `IDBKeyRange` onto
// globalThis, and cache.ts reads them at call time. Vitest's node
// environment has neither.
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DB_NAME,
  getAudio,
  getTranslations,
  putAudio,
  putTranslations,
  resetCacheState,
} from './cache'

/** A fresh database plus a fresh module-level state, which together are what
 *  a newly started service worker sees. */
async function freshDb(): Promise<void> {
  resetCacheState()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

/** WAV-shaped bytes. Contents are irrelevant; only the byte count is. */
function wav(bytes: number): ArrayBuffer {
  return new Uint8Array(bytes).fill(7).buffer
}

beforeEach(freshDb)
afterEach(() => resetCacheState())

describe('cache bản dịch', () => {
  it('trượt cache khi chưa có gì', async () => {
    expect(await getTranslations(['k1'])).toEqual(new Map())
  })

  it('ghi rồi đọc lại được', async () => {
    await putTranslations([{ key: 'k1', vi: 'xin chào', srcText: 'hello', lectureId: 'L1' }])
    expect(await getTranslations(['k1'])).toEqual(new Map([['k1', 'xin chào']]))
  })

  it('chỉ trả về những khoá có thật, bỏ qua khoá trượt', async () => {
    await putTranslations([{ key: 'k1', vi: 'một', srcText: 'one', lectureId: 'L1' }])
    expect(await getTranslations(['k1', 'k2', 'k3'])).toEqual(new Map([['k1', 'một']]))
  })

  it('danh sách khoá rỗng thì trả về Map rỗng, không chạm DB', async () => {
    expect(await getTranslations([])).toEqual(new Map())
  })

  it('ghi đè cùng khoá thì giữ giá trị mới nhất', async () => {
    await putTranslations([{ key: 'k1', vi: 'cũ', srcText: 'hello', lectureId: 'L1' }])
    await putTranslations([{ key: 'k1', vi: 'mới', srcText: 'hello', lectureId: 'L2' }])
    expect(await getTranslations(['k1'])).toEqual(new Map([['k1', 'mới']]))
  })

  it('đọc xong thì cập nhật lastUsed, để LRU biết bản ghi này còn dùng', async () => {
    await putTranslations([{ key: 'k1', vi: 'v', srcText: 's', lectureId: 'L1' }])
    const before = await readLastUsed('translations', 'k1')
    // Date.now() has millisecond resolution; without a gap the touched value
    // can legitimately equal the written one and the assertion says nothing.
    await new Promise((r) => setTimeout(r, 5))
    await getTranslations(['k1'])
    expect(await readLastUsed('translations', 'k1')).toBeGreaterThan(before)
  })

  it('giữ lại lectureId để M3b dọn cache theo bài', async () => {
    await putTranslations([{ key: 'k1', vi: 'v', srcText: 's', lectureId: 'L42' }])
    expect(await readField('translations', 'k1', 'lectureId')).toBe('L42')
  })
})

describe('cache audio', () => {
  it('trượt cache khi chưa có gì', async () => {
    expect(await getAudio('a1')).toBeNull()
  })

  it('ghi rồi đọc lại đúng byte và đúng thời lượng', async () => {
    await putAudio('a1', wav(1024), 3.5)
    const got = await getAudio('a1')
    expect(got?.duration).toBe(3.5)
    expect(got?.wav.byteLength).toBe(1024)
    expect(new Uint8Array(got!.wav)[0]).toBe(7)
  })

  it('đọc xong thì cập nhật lastUsed', async () => {
    await putAudio('a1', wav(16), 1)
    const before = await readLastUsed('audio', 'a1')
    await new Promise((r) => setTimeout(r, 5))
    await getAudio('a1')
    expect(await readLastUsed('audio', 'a1')).toBeGreaterThan(before)
  })

  it('lưu kích thước thật để LRU tính được', async () => {
    await putAudio('a1', wav(2048), 1)
    expect(await readField('audio', 'a1', 'bytes')).toBe(2048)
  })
})

describe('sống sót qua việc service worker bị giết', () => {
  it('dữ liệu vẫn còn sau khi trạng thái trong bộ nhớ bị xoá sạch', async () => {
    await putTranslations([{ key: 'k1', vi: 'bền', srcText: 's', lectureId: 'L1' }])
    await putAudio('a1', wav(64), 2)

    // Exactly what a terminated service worker leaves behind: the database
    // survives, every module-level variable does not.
    resetCacheState()

    expect(await getTranslations(['k1'])).toEqual(new Map([['k1', 'bền']]))
    expect((await getAudio('a1'))?.duration).toBe(2)
  })
})

// --- helpers that read the raw rows, so tests can assert on bookkeeping
// fields the public API deliberately does not expose ---

function openRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readRow(store: string, key: string): Promise<Record<string, unknown>> {
  const db = await openRaw()
  try {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    return await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as Record<string, unknown>)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function readLastUsed(store: string, key: string): Promise<number> {
  return (await readRow(store, key)).lastUsed as number
}

async function readField(store: string, key: string, field: string): Promise<unknown> {
  return (await readRow(store, key))[field]
}
