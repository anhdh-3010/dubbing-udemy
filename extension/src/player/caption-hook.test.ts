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
    expect(isCaptionUrlAllowed('https://x.udemycdn.com/25721448/en_GB/en.vtt')).toBe(true)
    expect(isCaptionUrlAllowed('https://www.udemy.com/25721448/en_GB/en.vtt')).toBe(true)
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

  it('từ chối đường dẫn không phải .vtt trên host hợp lệ', () => {
    expect(isCaptionUrlAllowed('https://mobile.udemy.com/api-2.0/users/me/?x=.vtt')).toBe(false)
  })

  it('vẫn nhận URL phụ đề thật có query string', () => {
    expect(isCaptionUrlAllowed('https://x.udemycdn.com/25721448/en_GB/en.vtt?token=abc')).toBe(true)
  })

  it('nhận cả 8 URL phụ đề thật lấy từ API của Udemy', () => {
    const realCaptionUrls = [
      'https://vtt-c.udemycdn.com/25721448/ja_JP/2023-03-30_05-08-46-1b68e787.vtt?Expires=1789894930&Signature=X',
      'https://vtt-c.udemycdn.com/25721448/es_ES/2024-06-25_11-19-39-4b289f26.vtt?Expires=1789894930&Signature=X',
      'https://vtt-c.udemycdn.com/25721448/en_GB/2020-07-03_20-18-24-dc5c1fda.vtt?Expires=1789894930&Signature=X',
      'https://vtt-c.udemycdn.com/25721448/tr_TR/2024-11-20_16-49-21-387cce80.vtt?Expires=1789894930&Signature=X',
      'https://vtt-c.udemycdn.com/25721448/zh_CN/2023-10-28_18-37-57-1949ff2d.vtt?Expires=1789894930&Signature=X',
      'https://vtt-c.udemycdn.com/25721448/de_DE/2024-09-18_11-31-30-4f3770e1.vtt?Expires=1789894930&Signature=X',
      'https://vtt-c.udemycdn.com/25721448/pt_BR/2024-02-23_09-52-47-f01da34c.vtt?Expires=1789894930&Signature=X',
      'https://vtt-c.udemycdn.com/25721448/it_IT/2024-09-26_10-50-23-8faac56e.vtt?Expires=1789894930&Signature=X',
    ]
    for (const url of realCaptionUrls) {
      expect(isCaptionUrlAllowed(url)).toBe(true)
    }
  })

  it('từ chối track ảnh thu nhỏ của thanh tua (thumb-sprites.vtt) vì không có đoạn locale trước tên file', () => {
    expect(
      isCaptionUrlAllowed(
        'https://mp4-c.udemycdn.com/2020-06-23_23-14-30-5bf09f75/1/thumb-sprites.vtt?Expires=1789896405&Signature=X',
      ),
    ).toBe(false)
  })
})
