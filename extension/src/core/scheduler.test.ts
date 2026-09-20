import { describe, expect, it, vi } from 'vitest'
import { Scheduler } from './scheduler'
import { FakeTTS, FakeUtterance, FakeVideo } from './testing/fakes'
import type { Segment, TTSProvider } from './types'

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

/** Utterances the scheduler actually spoke. Once it prepares a sentence
 *  ahead of its slot, `tts.prepared.length` stops answering "did it speak?"
 *  — it also counts work done for a slot that has not arrived yet. */
const played = (tts: FakeTTS): FakeUtterance[] => tts.prepared.filter((u) => u.played)

/** The utterance being spoken, as opposed to one merely prepared. */
const spoken = (tts: FakeTTS): FakeUtterance | undefined => tts.prepared.find((u) => u.played)

describe('Scheduler', () => {
  it('chưa đọc gì khi video chưa tới segment đầu', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()
    expect(played(tts)).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
  })

  it('bắt đầu đọc khi video chạm start của segment', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(spoken(tts)).toBeDefined()
  })

  it('hạ âm lượng gốc khi đang đọc và trả lại khi xong', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(video.volume).toBeCloseTo(0.1)
    spoken(tts)!.finish()
    await vi.waitFor(() => expect(video.volume).toBeCloseTo(1))
  })

  it('không đọc lại segment đã đọc', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    spoken(tts)!.finish()
    await vi.waitFor(() => expect(video.volume).toBeCloseTo(1))
    video.currentTime = 2.0
    await scheduler.tick()
    expect(played(tts)).toHaveLength(1)
  })

  it('làm chậm video khi bản dịch dài hơn khung, rồi khôi phục', async () => {
    const { video, tts, scheduler } = setup(() => 20)
    video.currentTime = 1.0
    await scheduler.tick()
    expect(video.playbackRate).toBeLessThan(1)
    spoken(tts)!.finish()
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
    expect(spoken(tts)?.rateUsed).toBeCloseTo(1)
    expect(video.playbackRate).toBeCloseTo(1.5)
  })

  it('tua thì huỷ câu đang đọc và khôi phục âm lượng', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    scheduler.onSeek()
    expect(spoken(tts)?.cancelled).toBe(true)
    expect(video.volume).toBeCloseTo(1)
  })

  it('tạm dừng thì huỷ câu đang đọc và khôi phục âm lượng/tốc độ', async () => {
    const { video, tts, scheduler } = setup(() => 20) // force stretching so rate leaves baseline
    video.currentTime = 1.0
    await scheduler.tick()
    expect(video.volume).toBeCloseTo(0.1)
    expect(video.playbackRate).toBeLessThan(1)
    scheduler.onPause()
    expect(spoken(tts)?.cancelled).toBe(true)
    expect(video.volume).toBeCloseTo(1)
    expect(video.playbackRate).toBeCloseTo(1) // restored to baseline
  })

  it('tạm dừng không đánh dấu lại spoken: tick ở cùng vị trí không đọc lại', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    scheduler.onPause()
    expect(played(tts)).toHaveLength(1)

    // Viewer resumes at the same position tick() already committed to.
    video.currentTime = 1.0
    await scheduler.tick()
    // Unlike onSeek(), onPause() must leave `spoken` intact, so this segment
    // is not re-selected and no second utterance is prepared.
    expect(played(tts)).toHaveLength(1)
  })

  it('sau khi tua lùi thì đọc lại segment đó', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    scheduler.onSeek()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(played(tts)).toHaveLength(2)
  })

  it('bỏ qua segment chưa dịch xong và không hạ âm lượng', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.setSegments([
      { id: 0, start: 1, end: 5, srcText: 'a', status: 'pending' },
    ])
    video.currentTime = 1.0
    await scheduler.tick()
    expect(played(tts)).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
  })

  it('video đang tạm dừng thì không bắt đầu câu mới', async () => {
    const { video, tts, scheduler } = setup()
    video.paused = true
    video.currentTime = 1.0
    await scheduler.tick()
    expect(played(tts)).toHaveLength(0)
  })

  it('bỏ qua segment đã trôi quá xa thay vì đọc đuổi', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 4.0 // vào segment 0 đã 3 giây, quá ngưỡng 1.5
    await scheduler.tick()
    expect(played(tts)).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
  })

  it('vẫn đọc khi chỉ trễ trong ngưỡng cho phép', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 2.0 // trễ 1 giây, dưới ngưỡng
    await scheduler.tick()
    expect(spoken(tts)).toBeDefined()
  })

  it('tính ngân sách từ lúc thực sự bắt đầu đọc, không từ start của segment', async () => {
    const { video, tts, scheduler } = setup(() => 5)
    video.currentTime = 2.0 // trễ 1 giây so với start = 1
    await scheduler.tick()
    // Còn 3 giây segment + 1 giây lặng = 4 giây thực, nên 5 giây đọc phải
    // nhanh lên 1.25 lần. Nếu tính từ start = 1 thì ngân sách thành 5 giây và
    // tốc độ bị kẹp về 1.0.
    expect(spoken(tts)?.rateUsed).toBeCloseTo(1.25)
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
    expect(played(tts)).toHaveLength(1)
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
    expect(played(tts)).toHaveLength(0)
    expect(tts.prepared.every((u) => u.cancelled)).toBe(true)
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
    expect(played(tts)).toHaveLength(0)
  })
})

describe('Scheduler: chuẩn bị trước', () => {
  it('chuẩn bị câu sắp tới trước khi video chạm nó', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()

    // Nothing is being spoken yet — this prepare exists only because the
    // sentence starts within the lookahead window.
    expect(tts.texts).toEqual(['câu một'])
    expect(tts.prepared[0].played).toBe(false)
  })

  it('dùng lại câu đã chuẩn bị thay vì tổng hợp lại', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()

    video.currentTime = 1.0
    await scheduler.tick()

    // Still one prepare, and it is the one that got played. Without the
    // prefetch path this would be two, and the second would start 0.8s into
    // the slot on the real provider.
    expect(tts.texts).toEqual(['câu một'])
    expect(tts.prepared[0].played).toBe(true)
  })

  it('chuẩn bị câu kế tiếp trong lúc đang đọc câu hiện tại', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()

    video.currentTime = 2.0
    await scheduler.tick()

    expect(tts.texts).toContain('câu hai')
  })

  it('không chuẩn bị câu còn quá xa', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.setSegments([
      { id: 0, start: 1, end: 5, srcText: 'a', viText: 'câu một', status: 'ready' },
      { id: 1, start: 30, end: 34, srcText: 'b', viText: 'câu hai', status: 'ready' },
    ])
    video.currentTime = 1.0
    await scheduler.tick()

    // 29 seconds out, well past PREFETCH_LEAD. Preparing it now would be
    // thrown away by the first seek and would hold the one prefetch slot
    // against the sentence that actually needs it.
    expect(tts.texts).toEqual(['câu một'])
  })

  it('không chuẩn bị câu chưa dịch xong', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.setSegments([
      { id: 0, start: 1, end: 5, srcText: 'a', viText: 'câu một', status: 'ready' },
      { id: 1, start: 6, end: 10, srcText: 'b', status: 'pending' },
    ])
    video.currentTime = 1.0
    await scheduler.tick()

    expect(tts.texts).toEqual(['câu một'])
  })

  it('huỷ phần đã chuẩn bị khi người xem tua', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(1)

    scheduler.onSeek()

    // Cancelled, not merely forgotten: the real provider holds a blob URL
    // that leaks if nobody releases it.
    await vi.waitFor(() => expect(tts.prepared[0].cancelled).toBe(true))
  })

  it('bỏ phần đã chuẩn bị cho câu bị bỏ qua vì vào quá muộn', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()

    // 3.9s into a slot that started at 1 — past MAX_LATENESS, so tick()
    // skips it and the prepared sentence will never be consumed.
    video.currentTime = 4.9
    await scheduler.tick()
    await scheduler.tick()

    await vi.waitFor(() => expect(tts.prepared[0].cancelled).toBe(true))
    expect(tts.texts).toContain('câu hai')
  })

  it('vẫn đọc được khi việc chuẩn bị trước thất bại', async () => {
    const video = new FakeVideo()
    const made: FakeUtterance[] = []
    let calls = 0
    const flaky: TTSProvider = {
      name: 'flaky',
      knowsDurationAhead: true,
      isAvailable: async () => true,
      prepare: async () => {
        calls++
        if (calls === 1) throw new Error('synthesis failed')
        const u = new FakeUtterance(2)
        made.push(u)
        return u
      },
    }
    const scheduler = new Scheduler({ video, provider: flaky })
    scheduler.setSegments(segs())

    video.currentTime = 0.5
    await scheduler.tick()
    await vi.waitFor(() => expect(calls).toBe(1))

    video.currentTime = 1.0
    await scheduler.tick()

    // A failed prefetch must not poison the slot: speak() synthesises live
    // instead, exactly as it did before this feature existed.
    await vi.waitFor(() => expect(made.some((u) => u.played)).toBe(true))
  })

  it('để nguyên âm lượng gốc khi tổng hợp thất bại hẳn', async () => {
    // Spec 10: a segment whose synthesis fails is skipped and the original
    // audio plays at full volume for that slot. Unchanged since M1, but
    // untested until now, and take() is the code that has to keep it true.
    const video = new FakeVideo()
    const broken: TTSProvider = {
      name: 'broken',
      knowsDurationAhead: true,
      isAvailable: async () => true,
      prepare: async () => {
        throw new Error('synthesis failed')
      },
    }
    const scheduler = new Scheduler({ video, provider: broken })
    scheduler.setSegments(segs())

    video.currentTime = 1.0
    await scheduler.tick()

    expect(video.volume).toBeCloseTo(1)
    expect(video.playbackRate).toBeCloseTo(1)
  })
})
