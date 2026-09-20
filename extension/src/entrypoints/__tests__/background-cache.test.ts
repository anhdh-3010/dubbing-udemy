import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL_ID, TARGET_LANG } from '../../background/gemini'
import { TTS_STEPS, TTS_VOICE } from '../../background/tts'
import { audioKey, translationKey } from '../../core/cache-policy'
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
const getAudio = vi.fn(async (_key: string) => null as { wav: ArrayBuffer; duration: number } | null)
const putAudio = vi.fn(async () => {
  // Two microtask hops, deliberately: with a fully synchronous body (just
  // `calls.push(...)`, no `await` inside), the push happens at *call* time,
  // not at *settle* time — so dropping `await putAudio(...)` in speakCached
  // does not reorder `calls` at all, and the "written BEFORE the reply"
  // test below stays green whether or not the write is actually awaited.
  // Verified in task-6-report.md's Step 7: with a synchronous body, the
  // order-inversion mutation left this test green. These two hops give the
  // reply's own single-hop `.then` a chance to run first when the write
  // isn't awaited, so the mutation is actually caught.
  await Promise.resolve()
  await Promise.resolve()
  calls.push('putAudio')
})
const deleteAudio = vi.fn(async (_key: string) => {})

vi.mock('../../background/cache', () => ({
  getTranslations: (keys: readonly string[]) => getTranslations(keys),
  putTranslations: () => putTranslations(),
  getAudio: (key: string) => getAudio(key),
  putAudio: () => putAudio(),
  deleteAudio: (key: string) => deleteAudio(key),
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
          // Named `viText`, not `vi` — this arrow runs inside a file that
          // imports vitest's own `vi`, and shadowing it here would trap
          // whoever next needs `vi` (e.g. `vi.fn()`) inside this callback.
          parts: [{ text: JSON.stringify(pairs.map(([id, viText]) => ({ id, vi: viText }))) }],
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
  getAudio.mockClear()
  putAudio.mockClear()
  deleteAudio.mockClear()
  getTranslations.mockResolvedValue(new Map())
  getAudio.mockResolvedValue(null)
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

  it('cache ghi lỗi thì vẫn trả lời với bản dịch, không phải error', async () => {
    // The Gemini call underneath this batch already succeeded — that API
    // call has been paid for — by the time the cache write is attempted. A
    // write failure here must not throw the successful translation away and
    // report an error instead; the viewer must still get their dub.
    putTranslations.mockRejectedValueOnce(new Error('IndexedDB is on fire'))

    const res = await send({ type: 'translate', batch, lectureId: 'L1' })

    expect(res).toEqual({ translations: [[1, 'xin chào']] })
    // The rejected call never reaches the `calls.push('putTranslations')`
    // inside the mock's own implementation, so only sendResponse is
    // recorded — the reply still goes out despite the cache failure.
    expect(calls).toEqual(['sendResponse'])
  })
})

/** A TTS server reply carrying `bytes` as the WAV body. */
function ttsReturning(bytes: number[], duration: number): typeof fetch {
  return vi.fn(
    async () =>
      new Response(new Uint8Array(bytes) as unknown as BodyInit, {
        status: 200,
        headers: { 'X-Audio-Duration': String(duration) },
      }),
  ) as unknown as typeof fetch
}

describe('cache audio', () => {
  it('trúng cache thì trả về ngay và không gọi server', async () => {
    const fetchSpy = ttsReturning([1, 2, 3, 4], 9)
    vi.stubGlobal('fetch', fetchSpy)
    getAudio.mockResolvedValue({ wav: new Uint8Array([82, 73, 70, 70]).buffer, duration: 2.5 })

    const res = await send({ type: 'tts-speak', text: 'xin chào' })

    expect(res).toEqual({ audio: 'UklGRg==', duration: 2.5 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('tra cache bằng khoá gồm cả giọng và số bước', async () => {
    vi.stubGlobal('fetch', ttsReturning([82, 73, 70, 70], 1))
    await send({ type: 'tts-speak', text: 'xin chào' })
    expect(getAudio).toHaveBeenCalledWith(await audioKey('xin chào', TTS_VOICE, TTS_STEPS))
  })

  it('trượt cache thì tổng hợp, và ghi cache TRƯỚC khi trả lời', async () => {
    vi.stubGlobal('fetch', ttsReturning([82, 73, 70, 70], 2.5))

    const res = await send({ type: 'tts-speak', text: 'xin chào' })

    expect(res).toEqual({ audio: 'UklGRg==', duration: 2.5 })
    expect(calls).toEqual(['putAudio', 'sendResponse'])
  })

  it('tổng hợp hỏng thì không ghi cache và trả error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )

    const res = (await send({ type: 'tts-speak', text: 'xin chào' })) as { error?: string }

    expect(res.error).toContain('500')
    expect(putAudio).not.toHaveBeenCalled()
  })

  it('văn bản rỗng thì không tra cache và không gọi mạng', async () => {
    const res = (await send({ type: 'tts-speak', text: '   ' })) as { error?: string }
    expect(res.error).toContain('non-empty')
    expect(getAudio).not.toHaveBeenCalled()
  })

  it('bản ghi audio trong cache bị hỏng thì vẫn tổng hợp, vẫn trả lời, và xoá bản ghi hỏng', async () => {
    // A row IndexedDB could never have produced through this code's own
    // writer, but exactly the shape a foreign write or a future schema
    // change could leave behind: `wav` that does not decode into bytes.
    // `toBase64(new Uint8Array(hit.wav))` throws on it — the throw site the
    // cache-hit path does not otherwise protect.
    getAudio.mockResolvedValue({ wav: -1 as unknown as ArrayBuffer, duration: 9 })
    vi.stubGlobal('fetch', ttsReturning([82, 73, 70, 70], 2.5))

    const res = await send({ type: 'tts-speak', text: 'xin chào' })

    // The sentence still gets a dub — a malformed row must degrade to a
    // miss, not to `{error}`.
    expect(res).toEqual({ audio: 'UklGRg==', duration: 2.5 })
    // And the bad row is gone, so the same sentence is not silent again on
    // the very next replay.
    expect(deleteAudio).toHaveBeenCalledWith(await audioKey('xin chào', TTS_VOICE, TTS_STEPS))
  })

  it('audioKey ném lỗi thì vẫn tổng hợp bình thường, không tra hay ghi cache', async () => {
    // `audioKey` is derived BEFORE synthesis, which is exactly why it is not
    // covered by "the key is derived before synthesis" reasoning: if
    // deriving it fails, there is nothing to look up or write with.
    const digestSpy = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('crypto broke'))
    vi.stubGlobal('fetch', ttsReturning([82, 73, 70, 70], 2.5))

    try {
      const res = await send({ type: 'tts-speak', text: 'xin chào' })

      expect(res).toEqual({ audio: 'UklGRg==', duration: 2.5 })
      expect(getAudio).not.toHaveBeenCalled()
      expect(putAudio).not.toHaveBeenCalled()
    } finally {
      digestSpy.mockRestore()
    }
  })
})
