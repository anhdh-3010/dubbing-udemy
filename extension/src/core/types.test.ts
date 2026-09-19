import { describe, expect, it } from 'vitest'
import { isReady, type Segment } from './types'

describe('isReady', () => {
  it('true khi segment đã có bản dịch', () => {
    const seg: Segment = { id: 1, start: 0, end: 2, srcText: 'hello', viText: 'xin chào', status: 'ready' }
    expect(isReady(seg)).toBe(true)
  })

  it('false khi chưa dịch xong', () => {
    const seg: Segment = { id: 1, start: 0, end: 2, srcText: 'hello', status: 'pending' }
    expect(isReady(seg)).toBe(false)
  })

  it('false khi status là ready nhưng thiếu viText', () => {
    const seg: Segment = { id: 1, start: 0, end: 2, srcText: 'hello', status: 'ready' }
    expect(isReady(seg)).toBe(false)
  })
})
