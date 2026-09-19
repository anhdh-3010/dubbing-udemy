import { describe, expect, it } from 'vitest'
import { planBatches } from './batching'
import type { Segment } from './types'

const make = (n: number): Segment[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i, start: i * 5, end: i * 5 + 5, srcText: `line ${i}`, status: 'pending' as const,
  }))

describe('planBatches', () => {
  it('chia đúng kích thước lô', () => {
    const batches = planBatches(make(100), 0, 40)
    expect(batches.map((b) => b.length)).toEqual([40, 40, 20])
  })

  it('đặt lô chứa vị trí đang xem lên đầu', () => {
    // currentTime 220s rơi vào segment 44, tức lô thứ hai
    const batches = planBatches(make(100), 220, 40)
    expect(batches[0][0].id).toBe(40)
  })

  it('các lô còn lại giữ thứ tự phát', () => {
    const batches = planBatches(make(100), 220, 40)
    expect(batches.slice(1).map((b) => b[0].id)).toEqual([0, 80])
  })

  it('bỏ qua segment đã dịch xong', () => {
    const segs = make(10)
    segs[0].status = 'ready'
    segs[0].viText = 'đã dịch'
    const batches = planBatches(segs, 0, 40)
    expect(batches[0].every((s) => s.status !== 'ready')).toBe(true)
    expect(batches[0]).toHaveLength(9)
  })

  it('trả mảng rỗng khi mọi segment đã dịch', () => {
    const segs = make(3).map((s) => ({ ...s, status: 'ready' as const, viText: 'x' }))
    expect(planBatches(segs, 0, 40)).toEqual([])
  })

  it('currentTime vượt quá bài giảng thì vẫn trả đủ lô', () => {
    const batches = planBatches(make(10), 99999, 40)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(10)
  })
})
