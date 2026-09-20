import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CacheLookupRequest,
  FetchCaptionRequest,
  TranslateRequest,
  TtsHealthRequest,
  TtsSpeakRequest,
} from '../background'

type Message =
  | TranslateRequest
  | FetchCaptionRequest
  | TtsHealthRequest
  | TtsSpeakRequest
  | CacheLookupRequest
type SendResponse = (response: unknown) => void
type Listener = (msg: Message, sender: unknown, sendResponse: SendResponse) => boolean | void

/**
 * `defineBackground` is normally a WXT auto-import (`wxt/utils/define-background`)
 * that the extension's generated bootstrap calls later — there is no such loader
 * in this test. The real implementation just wraps its argument as `{ main: fn }`
 * (see `node_modules/wxt/dist/utils/define-background.mjs`), which is exactly the
 * `BackgroundDefinition` shape `background.ts`'s default export is typed as. The
 * stub mirrors that instead of shortcutting past it, so the test drives the same
 * `.main()` seam the real extension does, and stays type-correct without casts.
 */
function stubDefineBackground(): void {
  vi.stubGlobal('defineBackground', (main: () => void) => ({ main }))
}

describe('background: fetch-caption security gate', () => {
  let listener: Listener
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    stubDefineBackground()

    const addListener = vi.fn((l: Listener) => {
      listener = l
    })
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener } },
      storage: { local: { get: vi.fn(async () => ({})) } },
    })

    fetchMock = vi.fn(async () => new Response('irrelevant'))
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('../background')
    mod.default.main()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function sendFetchCaption(url: string): Promise<unknown> {
    return new Promise((resolve) => {
      listener({ type: 'fetch-caption', url }, {}, resolve)
    })
  }

  it('từ chối host lạ và không gọi fetch', async () => {
    const res = await sendFetchCaption('https://evil.com/x.vtt')
    expect(res).toMatchObject({ error: expect.any(String) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('từ chối localhost qua http (chặn ở bước kiểm tra giao thức) và không gọi fetch', async () => {
    const res = await sendFetchCaption('http://127.0.0.1:8000/x.vtt')
    expect(res).toMatchObject({ error: expect.any(String) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('từ chối localhost qua https (chặn ở bước kiểm tra host) và không gọi fetch', async () => {
    const res = await sendFetchCaption('https://127.0.0.1:8000/x.vtt')
    expect(res).toMatchObject({ error: expect.any(String) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('URL phụ đề hợp lệ thì gọi fetch kèm credentials và redirect error', async () => {
    await sendFetchCaption('https://x.udemycdn.com/25721448/en_GB/en.vtt')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://x.udemycdn.com/25721448/en_GB/en.vtt',
      expect.objectContaining({ credentials: 'include', redirect: 'error' }),
    )
  })

  it('phản hồi HTTP lỗi (vd 403 do link ký hết hạn) thì báo lỗi kèm mã trạng thái, không trả text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Forbidden</html>', { status: 403 }))
    const res = await sendFetchCaption('https://x.udemycdn.com/25721448/en_GB/en.vtt')
    expect(res).toMatchObject({ error: expect.stringContaining('403') })
    expect(res).not.toHaveProperty('text')
  })
})

describe('background: translate lỗi vĩnh viễn', () => {
  let listener: Listener

  beforeEach(async () => {
    vi.resetModules()
    stubDefineBackground()

    const addListener = vi.fn((l: Listener) => {
      listener = l
    })
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener } },
      storage: { local: { get: vi.fn(async () => ({ apiKey: 'KEY' })) } },
    })

    // A model-id 404, shaped like Gemini's real error body — the underlying
    // call fails permanently (not a bad key, not transient).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'model retired' } }), { status: 404 })),
    )

    const mod = await import('../background')
    mod.default.main()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lỗi dịch vĩnh viễn (404) trả về fatal: true để dừng bài giảng', async () => {
    const res = await new Promise((resolve) => {
      listener(
        {
          type: 'translate',
          batch: [{ id: 1, start: 0, end: 2, srcText: 'hi', status: 'pending' }],
          lectureId: 'L1',
        },
        {},
        resolve,
      )
    })
    expect(res).toMatchObject({ fatal: true })
  })
})

describe('background: TTS bridge', () => {
  let listener: Listener
  let fetchMock: ReturnType<typeof vi.fn>

  /** Drives the listener the way chrome.runtime.sendMessage does, and
   *  resolves with whatever the handler passes to sendResponse. */
  const send = (msg: unknown): Promise<unknown> =>
    new Promise((resolve) => {
      listener(msg as Message, null, resolve)
    })

  beforeEach(async () => {
    vi.resetModules()
    stubDefineBackground()

    const addListener = vi.fn((l: Listener) => {
      listener = l
    })
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener } },
      storage: { local: { get: vi.fn(async () => ({})) } },
    })

    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // NOTE: the task brief's Step 7 listing omits this call. Without it,
    // `defineBackground`'s callback (which registers the listener) never
    // runs, `listener` stays undefined, and every test below fails with
    // "TypeError: listener is not a function" instead of exercising the TTS
    // bridge — confirmed by running the brief's code verbatim before adding
    // this line. Restored to match the pattern the file's other two describe
    // blocks already use (see beforeEach above).
    const mod = await import('../background')
    mod.default.main()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tts-health báo ok khi server trả lời', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await send({ type: 'tts-health' })).toEqual({ ok: true })
    expect(String(fetchMock.mock.calls[0][0])).toContain('127.0.0.1')
  })

  it('tts-health báo không ok khi không kết nối được', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await send({ type: 'tts-health' })).toEqual({ ok: false })
  })

  it('tts-speak trả audio và thời lượng', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([82, 73, 70, 70]) as unknown as BodyInit, {
        status: 200,
        headers: { 'X-Audio-Duration': '2.5' },
      }),
    )
    expect(await send({ type: 'tts-speak', text: 'xin chào' })).toEqual({
      audio: 'UklGRg==',
      duration: 2.5,
    })
  })

  it('tts-speak trả error thay vì treo khi server hỏng', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    const res = (await send({ type: 'tts-speak', text: 'xin chào' })) as { error?: string }
    expect(res.error).toContain('500')
  })

  it('tts-speak từ chối văn bản rỗng mà không gọi mạng', async () => {
    const res = (await send({ type: 'tts-speak', text: '   ' })) as { error?: string }
    expect(res.error).toContain('non-empty')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
