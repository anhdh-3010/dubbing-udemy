import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchCaptionRequest, TranslateRequest } from '../background'

type Message = TranslateRequest | FetchCaptionRequest
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
        { type: 'translate', batch: [{ id: 1, start: 0, end: 2, srcText: 'hi', status: 'pending' }] },
        {},
        resolve,
      )
    })
    expect(res).toMatchObject({ fatal: true })
  })
})
