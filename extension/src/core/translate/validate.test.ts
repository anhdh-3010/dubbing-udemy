import { describe, expect, it } from 'vitest'
import { matchTranslations } from './validate'
import type { Segment } from '../types'

const batch: Segment[] = [
  { id: 1, start: 0, end: 2, srcText: 'a', status: 'pending' },
  { id: 2, start: 2, end: 4, srcText: 'b', status: 'pending' },
]

describe('matchTranslations', () => {
  it('khớp id với bản dịch', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"một"},{"id":2,"vi":"hai"}]')
    expect(r.matched.get(1)).toBe('một')
    expect(r.missing).toEqual([])
  })

  it('bóc được JSON nằm trong hàng rào markdown', () => {
    const raw = '```json\n[{"id":1,"vi":"một"},{"id":2,"vi":"hai"}]\n```'
    expect(matchTranslations(batch, raw).matched.size).toBe(2)
  })

  it('báo id thiếu thay vì im lặng', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"một"}]')
    expect(r.missing).toEqual([2])
  })

  it('bỏ qua id không thuộc lô', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"một"},{"id":99,"vi":"lạc"}]')
    expect(r.matched.has(99)).toBe(false)
    expect(r.missing).toEqual([2])
  })

  it('bỏ qua bản dịch rỗng và coi là thiếu', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"   "},{"id":2,"vi":"hai"}]')
    expect(r.missing).toEqual([1])
  })

  it('JSON hỏng thì coi như thiếu tất cả, không ném lỗi', () => {
    const r = matchTranslations(batch, 'not json at all')
    expect(r.matched.size).toBe(0)
    expect(r.missing).toEqual([1, 2])
  })

  it('bóc JSON trong hàng rào ngay cả khi có văn xuôi chứa dấu ngoặc ở trước', () => {
    const raw = 'Đây là kết quả [xem] bên dưới:\n```json\n[{"id":1,"vi":"một"},{"id":2,"vi":"hai"}]\n```'
    expect(matchTranslations(batch, raw).matched.size).toBe(2)
  })

  it('không ném lỗi khi có dấu ngoặc nhưng nội dung bên trong không phải JSON', () => {
    const r = matchTranslations(batch, 'not [valid json] here')
    expect(r.matched.size).toBe(0)
    expect(r.missing).toEqual([1, 2])
  })

  it('bỏ qua phần tử dị dạng và vẫn lấy được phần hợp lệ', () => {
    const r = matchTranslations(batch, '[1, "two", null, {"id":"1","vi":"x"}, {"id":2,"vi":"hai"}]')
    expect(r.matched.get(2)).toBe('hai')
    expect(r.matched.size).toBe(1)
    expect(r.missing).toEqual([1])
  })
})
