import { describe, expect, it, vi } from 'vitest'
import { Scheduler } from './scheduler'
import { FakeTTS, FakeVideo } from './testing/fakes'
import type { Segment } from './types'

const segs = (): Segment[] => [
  { id: 0, start: 1, end: 5, srcText: 'a', viText: 'câu một', status: 'ready' },
  { id: 1, start: 6, end: 10, srcText: 'b', viText: 'câu hai', status: 'ready' },
]

function setup(durationFor: (t: string) => number = () => 2) {
  const video = new FakeVideo()
  const tts = new FakeTTS(durationFor)
  const scheduler = new Scheduler({ video, provider: tts, duckVolume: 0.1 })
  scheduler.setSegments(segs())
  return { video, tts, scheduler }
}

describe('Scheduler', () => {
  it('chưa đọc gì khi video chưa tới segment đầu', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
  })

  it('bắt đầu đọc khi video chạm start của segment', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.last?.played).toBe(true)
  })

  it('hạ âm lượng gốc khi đang đọc và trả lại khi xong', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(video.volume).toBeCloseTo(0.1)
    tts.last!.finish()
    await vi.waitFor(() => expect(video.volume).toBeCloseTo(1))
  })

  it('không đọc lại segment đã đọc', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    tts.last!.finish()
    await vi.waitFor(() => expect(video.volume).toBeCloseTo(1))
    video.currentTime = 2.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(1)
  })

  it('làm chậm video khi bản dịch dài hơn khung, rồi khôi phục', async () => {
    const { video, tts, scheduler } = setup(() => 20)
    video.currentTime = 1.0
    await scheduler.tick()
    expect(video.playbackRate).toBeLessThan(1)
    tts.last!.finish()
    await vi.waitFor(() => expect(video.playbackRate).toBeCloseTo(1))
  })

  it('dùng tốc độ người dùng chọn làm baseline', async () => {
    const { video, tts, scheduler } = setup(() => 2)
    video.playbackRate = 1.5
    scheduler.setBaseline(1.5)
    video.currentTime = 1.0
    await scheduler.tick()
    // Khung 5 giây video (4 giây segment + 1 giây lặng) ở 1.5x còn 3.33 giây
    // thực; bản đọc 2 giây thừa chỗ nên không phải co giãn gì
    expect(tts.last?.rateUsed).toBeCloseTo(1)
    expect(video.playbackRate).toBeCloseTo(1.5)
  })

  it('tua thì huỷ câu đang đọc và khôi phục âm lượng', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    scheduler.onSeek()
    expect(tts.last?.cancelled).toBe(true)
    expect(video.volume).toBeCloseTo(1)
  })

  it('sau khi tua lùi thì đọc lại segment đó', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    scheduler.onSeek()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(2)
  })

  it('bỏ qua segment chưa dịch xong và không hạ âm lượng', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.setSegments([
      { id: 0, start: 1, end: 5, srcText: 'a', status: 'pending' },
    ])
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
  })

  it('video đang tạm dừng thì không bắt đầu câu mới', async () => {
    const { video, tts, scheduler } = setup()
    video.paused = true
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
  })

  it('bỏ qua segment đã trôi quá xa thay vì đọc đuổi', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 4.0 // vào segment 0 đã 3 giây, quá ngưỡng 1.5
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
  })

  it('vẫn đọc khi chỉ trễ trong ngưỡng cho phép', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 2.0 // trễ 1 giây, dưới ngưỡng
    await scheduler.tick()
    expect(tts.last?.played).toBe(true)
  })

  it('tính ngân sách từ lúc thực sự bắt đầu đọc, không từ start của segment', async () => {
    const { video, tts, scheduler } = setup(() => 5)
    video.currentTime = 2.0 // trễ 1 giây so với start = 1
    await scheduler.tick()
    // Còn 3 giây segment + 1 giây lặng = 4 giây thực, nên 5 giây đọc phải
    // nhanh lên 1.25 lần. Nếu tính từ start = 1 thì ngân sách thành 5 giây và
    // tốc độ bị kẹp về 1.0.
    expect(tts.last?.rateUsed).toBeCloseTo(1.25)
  })

  it('không bắt đầu câu thứ hai khi câu đầu còn đang chuẩn bị', async () => {
    const video = new FakeVideo()
    const tts = new FakeTTS(() => 2, 20)
    const scheduler = new Scheduler({ video, provider: tts, duckVolume: 0.1 })
    scheduler.setSegments(segs())
    video.currentTime = 1.0
    const first = scheduler.tick()
    video.currentTime = 6.0 // đã sang segment sau
    await scheduler.tick()
    await first
    expect(tts.prepared).toHaveLength(1)
    expect(video.volume).toBeCloseTo(0.1)
  })

  it('tua trong lúc đang chuẩn bị thì bỏ câu đó', async () => {
    const video = new FakeVideo()
    const tts = new FakeTTS(() => 2, 20)
    const scheduler = new Scheduler({ video, provider: tts, duckVolume: 0.1 })
    scheduler.setSegments(segs())
    video.currentTime = 1.0
    const pending = scheduler.tick()
    scheduler.onSeek()
    await pending
    expect(tts.last?.played).toBe(false)
    expect(tts.last?.cancelled).toBe(true)
    expect(video.volume).toBeCloseTo(1)
  })

  it('nhận ra tốc độ do chính nó ghi', async () => {
    const { video, scheduler } = setup(() => 20)
    video.currentTime = 1.0
    await scheduler.tick()
    expect(scheduler.isOwnRate(video.playbackRate)).toBe(true)
    expect(scheduler.isOwnRate(1.25)).toBe(false)
  })

  it('stop rồi thì tick không bắt đầu câu mới nữa', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.stop()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
  })
})
