import { describe, expect, it } from 'vitest'
import { computeStretch } from './rate'

describe('computeStretch', () => {
  it('không co giãn gì khi bản dịch vừa khung thời gian', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 4, baseline: 1,
    })
    expect(plan.ttsRate).toBe(1)
    expect(plan.videoRate).toBe(1)
  })

  it('tăng tốc đọc khi bản dịch dài hơn khung', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 6, baseline: 1,
    })
    expect(plan.ttsRate).toBeCloseTo(1.2)
    expect(plan.videoRate).toBe(1)
  })

  it('kẹp tốc độ đọc ở 1.4 và làm chậm video khi vẫn chưa đủ', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 10, baseline: 1,
    })
    expect(plan.ttsRate).toBe(1.4)
    expect(plan.videoRate).toBeLessThan(1)
    expect(plan.videoRate).toBeGreaterThanOrEqual(0.85)
  })

  it('không bao giờ hạ video xuống dưới 85% tốc độ người dùng chọn', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 100, baseline: 1,
    })
    expect(plan.videoRate).toBeCloseTo(0.85)
  })

  it('sàn làm chậm là tương đối theo baseline, không phải tuyệt đối', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 100, baseline: 1.5,
    })
    // 0.85 * 1.5, chứ không phải 0.85
    expect(plan.videoRate).toBeCloseTo(1.275)
  })

  it('người xem ở 1.5x có ngân sách thời gian thực co lại 1.5 lần', () => {
    // Khung 6 giây video, ở 1.5x chỉ còn 4 giây thực. Bản dịch 4 giây vừa khít.
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 6, gapAfter: 0, duration: 4, baseline: 1.5,
    })
    expect(plan.ttsRate).toBeCloseTo(1)
    expect(plan.videoRate).toBeCloseTo(1.5)
  })

  it('tính cả khoảng lặng sau segment vào ngân sách', () => {
    const withGap = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 2, duration: 6, baseline: 1,
    })
    expect(withGap.ttsRate).toBe(1)
  })

  it('không chia cho 0 khi khung thời gian bằng 0', () => {
    const plan = computeStretch({
      segmentStart: 3, segmentEnd: 3, gapAfter: 0, duration: 2, baseline: 1,
    })
    expect(Number.isFinite(plan.ttsRate)).toBe(true)
    expect(Number.isFinite(plan.videoRate)).toBe(true)
  })

  it('ngân sách thời gian thực co lại theo baseline, không phải theo khung video', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 8, gapAfter: 0, duration: 5, baseline: 2,
    })
    // haveWall = 8/2 = 4 giây thực, nên 5 giây đọc phải nhanh lên 1.25 lần.
    // Nếu bỏ phép chia cho baseline, haveWall = 8 và ttsRate bị kẹp về 1.0.
    expect(plan.ttsRate).toBeCloseTo(1.25)
  })

  it('làm chậm video khi ngân sách đã co theo baseline không còn đủ', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 8, gapAfter: 0, duration: 8, baseline: 2,
    })
    // haveWall = 4; ttsRate kẹp ở 1.4; needWall = 5.71 > 4 nên phải chạm sàn 0.85*2.
    // Nếu bỏ phép chia cho baseline, haveWall = 8, không cần chậm, videoRate = 2.
    expect(plan.ttsRate).toBeCloseTo(1.4)
    expect(plan.videoRate).toBeCloseTo(1.7)
  })

  it('khung thời gian bằng 0 thì không làm chậm video', () => {
    const plan = computeStretch({
      segmentStart: 3, segmentEnd: 3, gapAfter: 0, duration: 2, baseline: 1,
    })
    // Không có guard thì videoRate rơi xuống sàn 0.85 dù chẳng có gì để đọc vừa.
    expect(plan.videoRate).toBe(1)
  })
})
