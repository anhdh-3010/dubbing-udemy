import { describe, expect, it, vi } from 'vitest'
import { translateBatch } from './gemini'
import type { Segment } from '../core/types'

const batch: Segment[] = [
  { id: 1, start: 0, end: 2, srcText: 'hello', status: 'pending' },
]

const reply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })

describe('translateBatch', () => {
  it('trả về map id sang bản dịch', async () => {
    const f = vi.fn(async () => reply('[{"id":1,"vi":"xin chào"}]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(out.get(1)).toBe('xin chào')
  })

  it('gửi key trong header chứ không trong URL', async () => {
    const f = vi.fn(async () => reply('[{"id":1,"vi":"xin chào"}]'))
    await translateBatch(batch, 'SECRET', f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('SECRET')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET')
  })

  it('thử lại khi lô đầu thiếu id', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply('[]'))
      .mockResolvedValueOnce(reply('[{"id":1,"vi":"xin chào"}]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(2)
    expect(out.get(1)).toBe('xin chào')
  })

  it('bỏ cuộc sau hai lần thử lại và trả về phần dịch được', async () => {
    const f = vi.fn(async () => reply('[]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(3)
    expect(out.size).toBe(0)
  })

  it('ném lỗi rõ ràng khi key sai, không thử lại', async () => {
    const f = vi.fn(async () => new Response('forbidden', { status: 401 }))
    await expect(translateBatch(batch, 'BAD', f as unknown as typeof fetch)).rejects.toThrow(/key/i)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('thử lại khi bị giới hạn tần suất rồi thành công', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(reply('[{"id":1,"vi":"xin chào"}]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(2)
    expect(out.get(1)).toBe('xin chào')
  })

  it('giữ lại phần đã dịch được khi lần sau bị giới hạn tần suất', async () => {
    const two: Segment[] = [
      { id: 1, start: 0, end: 2, srcText: 'a', status: 'pending' },
      { id: 2, start: 2, end: 4, srcText: 'b', status: 'pending' },
    ]
    const f = vi.fn()
      .mockResolvedValueOnce(reply('[{"id":1,"vi":"một"}]'))
      .mockResolvedValue(new Response('rate limited', { status: 429 }))
    const out = await translateBatch(two, 'KEY', f as unknown as typeof fetch)
    expect(out.get(1)).toBe('một')
    expect(out.has(2)).toBe(false)
  })

  it('không báo lỗi tần suất cũ khi lần sau gọi được nhưng mô hình trả rỗng', async () => {
    // Each call gets its own `Response` (via a fresh `reply('[]')`), not a
    // shared one: a `Response` body can only be read once, and `callOnce`
    // reads it on every attempt that reaches `res.json()`.
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(reply('[]'))
      .mockResolvedValueOnce(reply('[]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(out.size).toBe(0)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('ném lỗi khi mọi lần thử đều bị giới hạn tần suất', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }))
    await expect(translateBatch(batch, 'KEY', f as unknown as typeof fetch)).rejects.toThrow(/429/)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('ném lỗi kèm nội dung của Google khi model bị gỡ (404), không thử lại', async () => {
    const f = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 404,
            message:
              'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements.',
            status: 'NOT_FOUND',
          },
        }),
        { status: 404 },
      ),
    )
    await expect(translateBatch(batch, 'KEY', f as unknown as typeof fetch)).rejects.toThrow(
      /no longer available to new users/,
    )
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('vẫn thử lại ba lần khi lỗi máy chủ 500 (đường thử lại không đổi)', async () => {
    const f = vi.fn(async () => new Response('server error', { status: 500 }))
    await expect(translateBatch(batch, 'KEY', f as unknown as typeof fetch)).rejects.toThrow(/500/)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('lỗi 4xx khác với thân không phải JSON vẫn ném lỗi rõ ràng theo mã trạng thái, không văng khi phân tích', async () => {
    const f = vi.fn(async () => new Response('<html>Bad Request</html>', { status: 400 }))
    await expect(translateBatch(batch, 'KEY', f as unknown as typeof fetch)).rejects.toThrow(/400/)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
