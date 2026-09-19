import { describe, expect, it, vi } from 'vitest'
import { installCaptionHook, isCaptionUrlAllowed, type WindowLike } from './caption-hook'

function fakeWindow(): WindowLike {
  return { fetch: vi.fn(async () => new Response('ok')) } as unknown as WindowLike
}

describe('installCaptionHook', () => {
  it('báo URL khi trang fetch một file .vtt', async () => {
    const win = fakeWindow()
    const seen: string[] = []
    installCaptionHook(win, (u) => seen.push(u))
    await win.fetch('https://x.udemycdn.com/caption/en_US.vtt')
    expect(seen).toEqual(['https://x.udemycdn.com/caption/en_US.vtt'])
  })

  it('bỏ qua request không phải phụ đề', async () => {
    const win = fakeWindow()
    const seen: string[] = []
    installCaptionHook(win, (u) => seen.push(u))
    await win.fetch('https://www.udemy.com/api-2.0/users/me/')
    expect(seen).toEqual([])
  })

  it('nhận cả URL có query string', async () => {
    const win = fakeWindow()
    const seen: string[] = []
    installCaptionHook(win, (u) => seen.push(u))
    await win.fetch('https://x.udemycdn.com/c/en.vtt?token=abc')
    expect(seen).toHaveLength(1)
  })

  it('vẫn trả về Response gốc cho trang', async () => {
    const win = fakeWindow()
    installCaptionHook(win, () => {})
    const res = await win.fetch('https://x.udemycdn.com/c/en.vtt')
    expect(await res.text()).toBe('ok')
  })

  it('gỡ hook thì khôi phục fetch gốc', async () => {
    const win = fakeWindow()
    const original = win.fetch
    const uninstall = installCaptionHook(win, () => {})
    expect(win.fetch).not.toBe(original)
    uninstall()
    expect(win.fetch).toBe(original)
  })

  it('không làm hỏng lỗi mạng của trang', async () => {
    const win = { fetch: vi.fn(async () => { throw new Error('offline') }) } as unknown as WindowLike
    installCaptionHook(win, () => {})
    await expect(win.fetch('https://x.udemycdn.com/c/en.vtt')).rejects.toThrow('offline')
  })
})

describe('isCaptionUrlAllowed', () => {
  it('nhận URL phụ đề của Udemy và CDN của nó', () => {
    expect(isCaptionUrlAllowed('https://x.udemycdn.com/c/en.vtt')).toBe(true)
    expect(isCaptionUrlAllowed('https://www.udemy.com/c/en.vtt')).toBe(true)
  })

  it('từ chối host lạ, kể cả khi tên miền chỉ là hậu tố', () => {
    expect(isCaptionUrlAllowed('https://evil.com/en.vtt')).toBe(false)
    expect(isCaptionUrlAllowed('https://notudemy.com/en.vtt')).toBe(false)
    expect(isCaptionUrlAllowed('https://udemy.com.evil.com/en.vtt')).toBe(false)
  })

  it('từ chối localhost và giao thức không phải https', () => {
    expect(isCaptionUrlAllowed('http://127.0.0.1:8000/en.vtt')).toBe(false)
    expect(isCaptionUrlAllowed('http://www.udemy.com/en.vtt')).toBe(false)
    expect(isCaptionUrlAllowed('file:///etc/passwd')).toBe(false)
  })

  it('từ chối chuỗi không phải URL tuyệt đối', () => {
    expect(isCaptionUrlAllowed('./sample.vtt')).toBe(false)
    expect(isCaptionUrlAllowed('')).toBe(false)
  })
})
