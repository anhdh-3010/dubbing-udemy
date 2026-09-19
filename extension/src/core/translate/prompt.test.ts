import { describe, expect, it } from 'vitest'
import { buildPrompt } from './prompt'
import type { Segment } from '../types'

const batch: Segment[] = [
  { id: 7, start: 0, end: 3, srcText: 'today we implement a project react', status: 'pending' },
  { id: 8, start: 3, end: 5, srcText: 'with backend fastapi', status: 'pending' },
]

describe('buildPrompt', () => {
  it('liệt kê từng câu kèm id', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('"id": 7')
    expect(p).toContain('today we implement a project react')
  })

  it('yêu cầu giữ nguyên thuật ngữ IT bằng tiếng Anh', () => {
    const p = buildPrompt(batch)
    expect(p.toLowerCase()).toContain('english')
  })

  it('nêu ví dụ chuẩn của spec', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('project React')
    expect(p).toContain('FastAPI')
  })

  it('yêu cầu dịch gọn theo thời lượng', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('15%')
  })

  it('yêu cầu trả JSON thuần', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('JSON')
  })

  it('nêu rõ chỉ thị giữ thuật ngữ IT, không chỉ nhắc chữ English', () => {
    expect(buildPrompt(batch)).toContain('Keep IT terminology in English')
  })

  it('cấm mô hình gộp hoặc bỏ sót câu', () => {
    expect(buildPrompt(batch)).toContain('Never merge or drop entries')
  })
})
