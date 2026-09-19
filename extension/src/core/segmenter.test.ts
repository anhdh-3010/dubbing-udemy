import { describe, expect, it } from 'vitest'
import { mergeCues } from './segmenter'
import type { Cue } from './types'

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text })

describe('mergeCues', () => {
  it('gộp các mẩu cho tới khi gặp dấu kết câu', () => {
    const out = mergeCues([
      cue(0, 1, 'In this lesson'),
      cue(1, 2, 'we will build'),
      cue(2, 3, 'a React app.'),
      cue(3, 4, 'Let us start.'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].srcText).toBe('In this lesson we will build a React app.')
    expect(out[0].start).toBe(0)
    expect(out[0].end).toBe(3)
    expect(out[1].srcText).toBe('Let us start.')
  })

  it('cắt khi khoảng lặng vượt ngưỡng', () => {
    const out = mergeCues([cue(0, 1, 'first part'), cue(5, 6, 'second part')], {
      gapThreshold: 0.8,
    })
    expect(out).toHaveLength(2)
  })

  it('cắt khi vượt trần thời lượng dù chưa có dấu câu', () => {
    const cues = Array.from({ length: 20 }, (_, i) => cue(i, i + 1, `chunk ${i}`))
    const out = mergeCues(cues, { maxDuration: 12 })
    expect(out.length).toBeGreaterThan(1)
    for (const s of out) expect(s.end - s.start).toBeLessThanOrEqual(12)
  })

  it('đánh id tăng dần từ 0 và đặt status pending', () => {
    const out = mergeCues([cue(0, 1, 'one.'), cue(1, 2, 'two.')])
    expect(out.map((s) => s.id)).toEqual([0, 1])
    expect(out.every((s) => s.status === 'pending')).toBe(true)
  })

  it('coi dấu ? và ! là kết câu', () => {
    const out = mergeCues([cue(0, 1, 'Ready?'), cue(1, 2, 'Go!')])
    expect(out).toHaveLength(2)
  })

  it('không cắt ở dấu chấm của chữ viết tắt', () => {
    const out = mergeCues([cue(0, 1, 'the e.g. case'), cue(1, 2, 'continues here.')])
    expect(out).toHaveLength(1)
  })

  it('không cắt khi cue kết thúc bằng chữ viết tắt', () => {
    const out = mergeCues([cue(0, 1, 'this works for e.g.'), cue(1, 2, 'React and Vue.')])
    expect(out).toHaveLength(1)
  })

  it('trả mảng rỗng cho đầu vào rỗng', () => {
    expect(mergeCues([])).toEqual([])
  })
})
