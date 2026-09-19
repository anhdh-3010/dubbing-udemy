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
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
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
})
