import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUDIO_QUOTA_BYTES,
  PROMPT_VERSION,
  TRANSLATION_MAX_ENTRIES,
  audioKey,
  planEvictions,
  sha256Hex,
  translationKey,
} from './cache-policy'

describe('sha256Hex', () => {
  it('khớp vector chuẩn của SHA-256', async () => {
    // The canonical NIST test vector for "abc". Pinning a known-good value
    // proves this is real SHA-256 and not merely self-consistent.
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('băm theo UTF-8, không theo UTF-16', async () => {
    // "é" is one UTF-16 code unit but two UTF-8 bytes. A digest taken over
    // the wrong encoding would still be stable, so only a pinned vector
    // catches it — and caption text is full of non-ASCII once translated.
    expect(await sha256Hex('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    )
  })

  it('hai chuỗi khác nhau cho hai digest khác nhau', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'))
  })
})

describe('translationKey', () => {
  it('cùng đầu vào cho cùng một khoá', async () => {
    const a = await translationKey('Hello world', 'vi', 'gemini-3.5-flash-lite')
    const b = await translationKey('Hello world', 'vi', 'gemini-3.5-flash-lite')
    expect(a).toBe(b)
  })

  it('đổi câu gốc thì đổi khoá', async () => {
    const a = await translationKey('Hello world', 'vi', 'm')
    const b = await translationKey('Hello there', 'vi', 'm')
    expect(a).not.toBe(b)
  })

  it('đổi model thì đổi khoá', async () => {
    const a = await translationKey('Hello', 'vi', 'model-a')
    const b = await translationKey('Hello', 'vi', 'model-b')
    expect(a).not.toBe(b)
  })

  it('đổi ngôn ngữ đích thì đổi khoá', async () => {
    const a = await translationKey('Hello', 'vi', 'm')
    const b = await translationKey('Hello', 'th', 'm')
    expect(a).not.toBe(b)
  })

  it('đổi phiên bản prompt thì đổi khoá', async () => {
    // The prompt carries the IT-terminology rules and the length budget.
    // Change those and every cached translation was made under rules that
    // no longer apply, so the version must be part of the key.
    const a = await translationKey('Hello', 'vi', 'm', 1)
    const b = await translationKey('Hello', 'vi', 'm', 2)
    expect(a).not.toBe(b)
  })

  it('mặc định dùng PROMPT_VERSION hiện hành', async () => {
    expect(await translationKey('Hello', 'vi', 'm')).toBe(
      await translationKey('Hello', 'vi', 'm', PROMPT_VERSION),
    )
  })
})

describe('audioKey', () => {
  it('đổi giọng thì đổi khoá', async () => {
    expect(await audioKey('xin chào', 'Minh Quân', 8)).not.toBe(
      await audioKey('xin chào', 'Linh', 8),
    )
  })

  it('đổi số bước thì đổi khoá', async () => {
    expect(await audioKey('xin chào', 'Minh Quân', 8)).not.toBe(
      await audioKey('xin chào', 'Minh Quân', 16),
    )
  })

  it('khoá bản dịch và khoá audio không bao giờ đụng nhau', async () => {
    // Different stores today, but a shared-store refactor must not silently
    // make a translation row answer an audio lookup.
    const t = await translationKey('xin chào', 'vi', 'Minh Quân')
    const a = await audioKey('xin chào', 'Minh Quân', 8)
    expect(t).not.toBe(a)
  })
})

describe('planEvictions', () => {
  const lru = [
    { key: 'oldest', cost: 100 },
    { key: 'middle', cost: 100 },
    { key: 'newest', cost: 100 },
  ]

  it('dưới hạn mức thì không dọn gì', () => {
    expect(planEvictions(lru, 250, 300)).toEqual({ keys: [], freed: 0 })
  })

  it('đúng bằng hạn mức thì không dọn gì', () => {
    expect(planEvictions(lru, 300, 300)).toEqual({ keys: [], freed: 0 })
  })

  it('vượt hạn mức thì dọn từ ít dùng nhất, vừa đủ để xuống dưới', () => {
    expect(planEvictions(lru, 300, 150)).toEqual({ keys: ['oldest', 'middle'], freed: 200 })
  })

  it('dừng ngay khi đã đủ, không dọn thừa', () => {
    expect(planEvictions(lru, 300, 250)).toEqual({ keys: ['oldest'], freed: 100 })
  })

  it('hạn mức bằng 0 thì dọn sạch', () => {
    expect(planEvictions(lru, 300, 0)).toEqual({
      keys: ['oldest', 'middle', 'newest'],
      freed: 300,
    })
  })

  it('không bao giờ lặp vô hạn khi mọi bản ghi có cost 0', () => {
    // Only reachable when the running total in `meta` has drifted above the
    // real size on disk. The self-heal in Task 2 is what repairs that; this
    // test only proves the planner terminates instead of spinning.
    const zeroes = [
      { key: 'a', cost: 0 },
      { key: 'b', cost: 0 },
    ]
    expect(planEvictions(zeroes, 999, 10)).toEqual({ keys: ['a', 'b'], freed: 0 })
  })

  it('danh sách rỗng thì trả về rỗng dù tổng có vượt', () => {
    expect(planEvictions([], 999, 10)).toEqual({ keys: [], freed: 0 })
  })
})

describe('hằng số', () => {
  it('quota audio mặc định là 300 MB', () => {
    expect(DEFAULT_AUDIO_QUOTA_BYTES).toBe(300 * 1024 * 1024)
  })

  it('trần bản dịch là 50.000 bản ghi', () => {
    expect(TRANSLATION_MAX_ENTRIES).toBe(50_000)
  })
})
