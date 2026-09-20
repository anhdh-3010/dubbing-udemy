// Must be the first import: it installs `indexedDB` and `IDBKeyRange` onto
// globalThis, and cache.ts reads them at call time. Vitest's node
// environment has neither.
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DB_NAME,
  getAudio,
  getTranslations,
  isCacheDisabled,
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

describe('quota audio', () => {
  it('dưới quota thì không xoá gì', async () => {
    await putAudio('a1', wav(100), 1, 1000)
    await putAudio('a2', wav(100), 1, 1000)
    expect(await getAudio('a1')).not.toBeNull()
    expect(await getAudio('a2')).not.toBeNull()
  })

  it('vượt quota thì xoá bản ghi ít dùng nhất trước', async () => {
    await putAudio('oldest', wav(100), 1, 250)
    await new Promise((r) => setTimeout(r, 5))
    await putAudio('middle', wav(100), 1, 250)
    await new Promise((r) => setTimeout(r, 5))
    await putAudio('newest', wav(100), 1, 250)

    expect(await getAudio('oldest')).toBeNull()
    expect(await getAudio('middle')).not.toBeNull()
    expect(await getAudio('newest')).not.toBeNull()
  })

  it('đọc một bản ghi làm nó thoát khỏi lượt dọn kế tiếp', async () => {
    // This is the whole point of LRU over FIFO: a sentence the viewer keeps
    // scrubbing back to must outlive one they played once and moved past.
    await putAudio('a1', wav(100), 1, 250)
    await new Promise((r) => setTimeout(r, 5))
    await putAudio('a2', wav(100), 1, 250)
    await new Promise((r) => setTimeout(r, 5))

    await getAudio('a1') // a1 is now the most recently used, a2 the least
    await new Promise((r) => setTimeout(r, 5))

    await putAudio('a3', wav(100), 1, 250)

    expect(await getAudio('a1')).not.toBeNull()
    expect(await getAudio('a2')).toBeNull()
  })

  it('dọn vừa đủ để xuống dưới quota, không dọn sạch', async () => {
    await putAudio('a1', wav(100), 1, 10_000)
    await new Promise((r) => setTimeout(r, 5))
    await putAudio('a2', wav(100), 1, 10_000)
    await new Promise((r) => setTimeout(r, 5))
    // 300 bytes total against a 250 quota: one row is enough.
    await putAudio('a3', wav(100), 1, 250)

    expect(await getAudio('a1')).toBeNull()
    expect(await getAudio('a2')).not.toBeNull()
    expect(await getAudio('a3')).not.toBeNull()
  })

  it('quota bằng 0 thì cache audio rỗng nhưng không nổ', async () => {
    await putAudio('a1', wav(100), 1, 0)
    expect(await getAudio('a1')).toBeNull()
  })
})

describe('quota đọc từ chrome.storage.local', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dùng giá trị người dùng đặt', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: async () => ({ cacheQuotaBytes: 250 }) } },
    })
    await putAudio('a1', wav(100), 1)
    await new Promise((r) => setTimeout(r, 5))
    await putAudio('a2', wav(100), 1)
    await new Promise((r) => setTimeout(r, 5))
    await putAudio('a3', wav(100), 1)

    expect(await getAudio('a1')).toBeNull()
    expect(await getAudio('a3')).not.toBeNull()
  })

  it('không có chrome thì lùi về mặc định 300 MB thay vì nổ', async () => {
    // `chrome` is simply absent in this environment, so touching it raises a
    // ReferenceError. That must land on the default, not on an exception:
    // the cache has to work on the very first run, before any option exists.
    await putAudio('a1', wav(100), 1)
    expect(await getAudio('a1')).not.toBeNull()
  })

  it('giá trị rác trong storage thì lùi về mặc định', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: async () => ({ cacheQuotaBytes: 'ba trăm mê' }) } },
    })
    await putAudio('a1', wav(100), 1)
    expect(await getAudio('a1')).not.toBeNull()
  })
})

describe('trần số bản ghi bản dịch', () => {
  it('vượt trần thì xoá bản ghi ít dùng nhất trước', async () => {
    await putTranslations([{ key: 'k1', vi: 'một', srcText: 's1', lectureId: 'L' }], 2)
    await new Promise((r) => setTimeout(r, 5))
    await putTranslations([{ key: 'k2', vi: 'hai', srcText: 's2', lectureId: 'L' }], 2)
    await new Promise((r) => setTimeout(r, 5))
    await putTranslations([{ key: 'k3', vi: 'ba', srcText: 's3', lectureId: 'L' }], 2)

    expect(await getTranslations(['k1'])).toEqual(new Map())
    expect(await getTranslations(['k2', 'k3'])).toEqual(
      new Map([
        ['k2', 'hai'],
        ['k3', 'ba'],
      ]),
    )
  })

  it('dưới trần thì không xoá gì', async () => {
    await putTranslations(
      [
        { key: 'k1', vi: 'một', srcText: 's1', lectureId: 'L' },
        { key: 'k2', vi: 'hai', srcText: 's2', lectureId: 'L' },
      ],
      10,
    )
    expect((await getTranslations(['k1', 'k2'])).size).toBe(2)
  })
})

describe('đường lỗi của spec mục 9', () => {
  /** Something IndexedDB refuses to structured-clone. It makes `put()` throw
   *  synchronously, which is the cheapest faithful stand-in for the
   *  QuotaExceededError this code path exists to survive — the behaviour
   *  under test is "a write that fails", not the specific reason. */
  const unwritable = (): ArrayBuffer => (() => undefined) as unknown as ArrayBuffer

  it('ghi hỏng hai lần thì tắt cache cho phiên này, và không ném lỗi', async () => {
    expect(isCacheDisabled()).toBe(false)
    await expect(putAudio('bad', unwritable(), 1, 10_000)).resolves.toBeUndefined()
    expect(isCacheDisabled()).toBe(true)
  })

  it('cache đã tắt thì mọi thao tác thành trượt, dữ liệu cũ vẫn nằm yên trên đĩa', async () => {
    await putTranslations([{ key: 'k1', vi: 'còn đây', srcText: 's', lectureId: 'L' }])
    // Written before the cache is disabled, precisely so the read below
    // proves the short-circuit: without it, 'a1' would answer null simply
    // because nothing was ever written under that key, whether or not
    // `disabled` short-circuits the read at all.
    await putAudio('a1', wav(16), 1)
    await putAudio('bad', unwritable(), 1, 10_000)
    expect(isCacheDisabled()).toBe(true)

    expect(await getTranslations(['k1'])).toEqual(new Map())
    expect(await getAudio('a1')).toBeNull()

    // Nothing was deleted — a disabled cache stops being consulted, it does
    // not destroy what it already holds.
    resetCacheState()
    expect(await getTranslations(['k1'])).toEqual(new Map([['k1', 'còn đây']]))
    expect((await getAudio('a1'))?.duration).toBe(1)
  })

  it('service worker khởi động lại thì cache bật lại', async () => {
    await putAudio('bad', unwritable(), 1, 10_000)
    expect(isCacheDisabled()).toBe(true)
    resetCacheState()
    expect(isCacheDisabled()).toBe(false)
  })
})
