import { describe, expect, it } from 'vitest'
import type { Segment } from './types'
import { applyTranslations } from './apply-translations'

const seg = (id: number, srcText = `s${id}`): Segment => ({
  id,
  start: id,
  end: id + 1,
  srcText,
  // Explicit, not omitted: toMatchObject only matches an expected
  // `viText: undefined` against a received object that HAS the key (with
  // that value) — an object that never set it at all does not match, so an
  // omitted key here would make the first test's negative assertion fail
  // for a reason unrelated to what it's actually checking.
  viText: undefined,
  status: 'pending',
})

describe('applyTranslations', () => {
  it('gán bản dịch vào đúng segment và đánh dấu ready', () => {
    const segs = [seg(1), seg(2)]
    const applied = applyTranslations(segs, [[2, 'hai']])

    expect(applied).toBe(1)
    expect(segs[1]).toMatchObject({ viText: 'hai', status: 'ready' })
    expect(segs[0]).toMatchObject({ viText: undefined, status: 'pending' })
  })

  it('bỏ qua id không có trong danh sách, không nổ', () => {
    // The model renumbers ids often enough that gemini.ts has a retry loop
    // for it, and a cache row can outlive the segmentation that produced it.
    const segs = [seg(1)]
    expect(applyTranslations(segs, [[99, 'lạc']])).toBe(0)
    expect(segs[0].status).toBe('pending')
  })

  it('danh sách rỗng thì không đổi gì', () => {
    const segs = [seg(1)]
    expect(applyTranslations(segs, [])).toBe(0)
    expect(segs[0].status).toBe('pending')
  })

  it('cặp sau ghi đè cặp trước cho cùng một id', () => {
    const segs = [seg(1)]
    applyTranslations(segs, [
      [1, 'đầu'],
      [1, 'sau'],
    ])
    expect(segs[0].viText).toBe('sau')
  })

  it('không đụng tới segment đã ready từ trước', () => {
    const segs = [seg(1)]
    applyTranslations(segs, [[1, 'từ cache']])
    const applied = applyTranslations(segs, [])
    expect(applied).toBe(0)
    expect(segs[0]).toMatchObject({ viText: 'từ cache', status: 'ready' })
  })

  it('chuỗi rỗng vẫn là một bản dịch hợp lệ và vẫn được gán', () => {
    // A silent segment is a real outcome, not a failure — and leaving it
    // 'pending' would send it back to the LLM on every single lecture.
    const segs = [seg(1)]
    expect(applyTranslations(segs, [[1, '']])).toBe(1)
    expect(segs[0]).toMatchObject({ viText: '', status: 'ready' })
  })
})
