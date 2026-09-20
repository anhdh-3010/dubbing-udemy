import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL_ID, TARGET_LANG } from '../../background/gemini'
import { translationKey } from '../../core/cache-policy'
import type { CacheLookupRequest, TranslateRequest, TtsSpeakRequest } from '../background'

// Widened to every request type this file sends. Casting at the call site
// instead would assert something false about the value — the objection M2's
// Ruling 2 was written about.
type Message = CacheLookupRequest | TranslateRequest | TtsSpeakRequest
type Listener = (msg: Message, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void

/** Every call the service worker makes into the cache, in order, alongside
 *  the sendResponse calls — so a test can assert not just THAT the cache was
 *  written but that it was written BEFORE the reply went out. MV3 can kill
 *  the worker the moment it replies, so that order is load-bearing. */
const calls: string[] = []

const getTranslations = vi.fn(async (_keys: readonly string[]) => new Map<string, string>())
const putTranslations = vi.fn(async () => {
  calls.push('putTranslations')
})

vi.mock('../../background/cache', () => ({
  getTranslations: (keys: readonly string[]) => getTranslations(keys),
  putTranslations: () => putTranslations(),
  getAudio: async () => null,
  putAudio: async () => undefined,
  isCacheDisabled: () => false,
}))

let listener: Listener

function stubChrome(): void {
  vi.stubGlobal('defineBackground', (main: () => void) => ({ main }))
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: (l: Listener) => {
          listener = l
        },
      },
    },
    storage: { local: { get: async () => ({ apiKey: 'KEY' }) } },
  })
}

const send = (msg: Message): Promise<unknown> =>
  new Promise((resolve) => {
    listener(msg, null, (r) => {
      calls.push('sendResponse')
      resolve(r)
    })
  })

/** A Gemini reply that translates every id in the request. */
function geminiReturning(pairs: [number, string][]): typeof fetch {
  const body = JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(pairs.map(([id, vi]) => ({ id, vi }))) }],
        },
      },
    ],
  })
  return vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch
}

beforeEach(async () => {
  calls.length = 0
  getTranslations.mockClear()
  putTranslations.mockClear()
  getTranslations.mockResolvedValue(new Map())
  vi.resetModules()
  stubChrome()
  vi.stubGlobal('fetch', geminiReturning([[1, 'xin chào']]))
  const mod = await import('../background')
  mod.default.main()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cache-lookup', () => {
  it('trả về bản dịch đã cache, gắn đúng id của segment', async () => {
    const key = await translationKey('hello', TARGET_LANG, MODEL_ID)
    getTranslations.mockResolvedValue(new Map([[key, 'xin chào']]))

    const res = await send({
      type: 'cache-lookup',
      segments: [{ id: 7, srcText: 'hello' }],
    })

    expect(res).toEqual({ translations: [[7, 'xin chào']] })
  })

  it('trượt cache thì trả về danh sách rỗng', async () => {
    const res = await send({ type: 'cache-lookup', segments: [{ id: 1, srcText: 'hello' }] })
    expect(res).toEqual({ translations: [] })
  })

  it('chỉ trả về những segment có trong cache, giữ nguyên id', async () => {
    const key = await translationKey('two', TARGET_LANG, MODEL_ID)
    getTranslations.mockResolvedValue(new Map([[key, 'hai']]))

    const res = await send({
      type: 'cache-lookup',
      segments: [
        { id: 1, srcText: 'one' },
        { id: 2, srcText: 'two' },
        { id: 3, srcText: 'three' },
      ],
    })

    expect(res).toEqual({ translations: [[2, 'hai']] })
  })

  it('hai segment cùng nội dung đều nhận được bản dịch', async () => {
    // Content-addressed keys mean one cached row answers both. Courses repeat
    // sentences ("Let's run it."), so this is the ordinary case, not a corner.
    const key = await translationKey('run it', TARGET_LANG, MODEL_ID)
    getTranslations.mockResolvedValue(new Map([[key, 'chạy thử']]))

    const res = await send({
      type: 'cache-lookup',
      segments: [
        { id: 4, srcText: 'run it' },
        { id: 9, srcText: 'run it' },
      ],
    })

    expect(res).toEqual({
      translations: [
        [4, 'chạy thử'],
        [9, 'chạy thử'],
      ],
    })
  })

  it('cache ném lỗi thì vẫn trả lời, bằng danh sách rỗng', async () => {
    // The listener must always call sendResponse. Returning true and then
    // never replying hangs the content script until the port closes.
    getTranslations.mockRejectedValue(new Error('IndexedDB is on fire'))
    const res = await send({ type: 'cache-lookup', segments: [{ id: 1, srcText: 'x' }] })
    expect(res).toEqual({ translations: [] })
  })

  it('danh sách segment rỗng thì trả lời ngay', async () => {
    expect(await send({ type: 'cache-lookup', segments: [] })).toEqual({ translations: [] })
  })
})

describe('ghi cache khi dịch', () => {
  const batch: TranslateRequest['batch'] = [
    { id: 1, start: 0, end: 2, srcText: 'hello', status: 'pending' },
  ]

  it('ghi cache TRƯỚC khi trả lời', async () => {
    await send({ type: 'translate', batch, lectureId: 'L1' })
    expect(calls).toEqual(['putTranslations', 'sendResponse'])
  })

  it('API hỏng thì không ghi gì vào cache', async () => {
    // A 404, not a 500: gemini.ts treats 5xx as transient and walks its full
    // retry loop with backoff sleeps, which would make this test take a
    // second and a half to assert something that has nothing to do with
    // retries.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'model retired' } }), { status: 404 }),
      ),
    )
    vi.resetModules()
    stubChrome()
    const mod = await import('../background')
    mod.default.main()

    await send({ type: 'translate', batch, lectureId: 'L1' })
    expect(putTranslations).not.toHaveBeenCalled()
  })
})
