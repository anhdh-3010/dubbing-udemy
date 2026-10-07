import { describe, expect, it, vi } from 'vitest'
import { isLoopbackHttpUrl, synthesize, toBase64, ttsHealth } from './tts'

const BASE = 'http://127.0.0.1:8770'

/** A Response carrying `bytes` as the body and an exact duration header,
 *  shaped like what server/app.py actually returns. */
const wavResponse = (bytes: Uint8Array, duration = 1.5): Response =>
  new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': 'audio/wav', 'X-Audio-Duration': String(duration) },
  })

describe('isLoopbackHttpUrl', () => {
  it('chấp nhận 127.0.0.1 và localhost trên http', () => {
    expect(isLoopbackHttpUrl('http://127.0.0.1:8770')).toBe(true)
    expect(isLoopbackHttpUrl('http://localhost:5599')).toBe(true)
  })

  it('từ chối host khác, kể cả trong dải mạng nội bộ', () => {
    expect(isLoopbackHttpUrl('http://192.168.1.5:8770')).toBe(false)
    expect(isLoopbackHttpUrl('http://evil.example/v1/audio/speech')).toBe(false)
  })

  it('từ chối scheme khác và chuỗi không phải URL', () => {
    // https is not "safer" here — it is a different server. Accepting it
    // would let a redirect or a hosts-file entry move this off the machine.
    expect(isLoopbackHttpUrl('https://127.0.0.1:8770')).toBe(false)
    expect(isLoopbackHttpUrl('not a url')).toBe(false)
  })
})

describe('ttsHealth', () => {
  it('true khi server trả 200', async () => {
    // Explicit <typeof fetch> (not in the brief verbatim): without it, vi.fn
    // infers Parameters from this zero-arg callback as `[]`, and tsc rejects
    // `f.mock.calls[0][0]` below with "Tuple type '[]' has no element at
    // index '0'". The behaviour under test is unchanged.
    const f = vi.fn<typeof fetch>(async () => new Response('{"status":"ok"}', { status: 200 }))
    expect(await ttsHealth(f as unknown as typeof fetch, BASE)).toBe(true)
    expect(f.mock.calls[0][0]).toBe(`${BASE}/health`)
  })

  it('false khi server trả lỗi', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 500 }))
    expect(await ttsHealth(f as unknown as typeof fetch, BASE)).toBe(false)
  })

  it('false khi không kết nối được, không ném ra ngoài', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await ttsHealth(f as unknown as typeof fetch, BASE)).toBe(false)
  })
})

describe('synthesize', () => {
  it('POST đúng endpoint với giọng và steps đã chốt', async () => {
    // Same <typeof fetch> annotation and same reason as above — needed here
    // because .mock.calls[0][1] is also read as a RequestInit.
    const f = vi.fn<typeof fetch>(async () => wavResponse(new Uint8Array([82, 73, 70, 70])))
    await synthesize('xin chào', f as unknown as typeof fetch, BASE)

    expect(f.mock.calls[0][0]).toBe(`${BASE}/v1/audio/speech`)
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      input: 'xin chào',
      voice: 'Hải Đăng',
      steps: 8,
    })
  })

  it('trả byte WAV thô và thời lượng chính xác từ header', async () => {
    const f = vi.fn(async () => wavResponse(new Uint8Array([82, 73, 70, 70]), 2.5))
    const res = await synthesize('xin chào', f as unknown as typeof fetch, BASE)

    expect(Array.from(res.wav)).toEqual([82, 73, 70, 70])
    expect(res.duration).toBe(2.5)
  })

  it('ném lỗi kèm status khi server trả lỗi', async () => {
    const f = vi.fn(async () => new Response('boom', { status: 500 }))
    await expect(synthesize('x', f as unknown as typeof fetch, BASE)).rejects.toThrow('500')
  })

  it('ném lỗi khi thiếu header thời lượng thay vì đoán', async () => {
    // The scheduler's whole stretch calculation is built on an exact
    // duration (spec 6.2). Guessing one here would produce speech that
    // drifts for reasons nothing downstream could explain.
    const f = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2]) as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        }),
    )
    await expect(synthesize('x', f as unknown as typeof fetch, BASE)).rejects.toThrow(
      'X-Audio-Duration',
    )
  })

  it('từ chối base URL không phải loopback mà không gọi mạng', async () => {
    const f = vi.fn(async () => wavResponse(new Uint8Array([1])))
    await expect(
      synthesize('x', f as unknown as typeof fetch, 'http://evil.example'),
    ).rejects.toThrow('loopback')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('toBase64', () => {
  it('toBase64 chia chunk nên không tràn call stack với audio dài', () => {
    // String.fromCharCode(...bytes) spreads every byte as an argument and
    // throws "Maximum call stack size exceeded" at this size, which is why
    // the chunking in toBase64 is load-bearing rather than tidiness.
    const big = new Uint8Array(600_000)
    const encoded = toBase64(big)

    expect(encoded.length).toBe(800_000)
    expect(atob(encoded).length).toBe(600_000)
  })
})
