import { describe, expect, it, vi } from 'vitest'
import { cuesFromTextTracks, cuesFromTextTracksWhenReady } from './caption-source'

// jsdom does not implement addTextTrack (it is a stubbed notImplementedMethod
// that logs and returns undefined) nor VTTCue/TextTrack/TextTrackList at all,
// so the brief's DOM-based fixture cannot run here. This hand-built fake is
// shaped like the part of the DOM cuesFromTextTracks actually reads:
// video.textTracks (iterable), each track's `kind` and writable `mode`, and
// track.cues (iterable) whose entries carry startTime/endTime/text.
interface FakeCue {
  startTime: number
  endTime: number
  text: string
}

function fakeTrack(kind: string, cues: FakeCue[], language = '', label = '') {
  return { kind, mode: 'disabled', cues, language, label }
}

function videoWithTracks(...tracks: ReturnType<typeof fakeTrack>[]): HTMLVideoElement {
  return { textTracks: tracks } as unknown as HTMLVideoElement
}

describe('cuesFromTextTracks', () => {
  it('đọc được cue từ text track', () => {
    const video = videoWithTracks(
      fakeTrack('captions', [
        { startTime: 1, endTime: 3, text: 'first line' },
        { startTime: 3, endTime: 5, text: 'second line' },
      ]),
    )
    const cues = cuesFromTextTracks(video)
    expect(cues).toEqual([
      { start: 1, end: 3, text: 'first line' },
      { start: 3, end: 5, text: 'second line' },
    ])
  })

  it('trả mảng rỗng khi video không có track', () => {
    expect(cuesFromTextTracks(document.createElement('video'))).toEqual([])
  })

  it('bỏ qua track không phải captions/subtitles', () => {
    const descriptions = fakeTrack('descriptions', [{ startTime: 0, endTime: 2, text: 'audio description' }])
    const captions = fakeTrack('captions', [{ startTime: 1, endTime: 3, text: 'first line' }])
    const video = videoWithTracks(descriptions, captions)

    const cues = cuesFromTextTracks(video)

    expect(cues).toEqual([{ start: 1, end: 3, text: 'first line' }])
  })

  it('đặt mode của track captions thành hidden khi đọc', () => {
    const captions = fakeTrack('captions', [{ startTime: 1, endTime: 3, text: 'first line' }])
    const video = videoWithTracks(captions)

    cuesFromTextTracks(video)

    expect(captions.mode).toBe('hidden')
  })

  it('ưu tiên track tiếng Anh khi nhiều track đều có cue', () => {
    const spanish = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'hola' }], 'es')
    const english = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'hello' }], 'en')
    const video = videoWithTracks(spanish, english)

    const cues = cuesFromTextTracks(video)

    expect(cues).toEqual([{ start: 0, end: 2, text: 'hello' }])
  })

  it('với requireEnglish=true thì bỏ qua track không phải tiếng Anh dù đã có cue', () => {
    const spanish = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'hola' }], 'es')
    const video = videoWithTracks(spanish)

    expect(cuesFromTextTracks(video, true)).toEqual([])
  })
})

describe('cuesFromTextTracksWhenReady', () => {
  it('trả cue ngay nếu track tiếng Anh đã sẵn sàng, không cần chờ', async () => {
    const english = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'hello' }], 'en')
    const video = videoWithTracks(english)

    const cues = await cuesFromTextTracksWhenReady(video)

    expect(cues).toEqual([{ start: 0, end: 2, text: 'hello' }])
  })

  it('chờ tới khi track có cue ở lần đọc sau', async () => {
    vi.useFakeTimers()
    try {
      const english = fakeTrack('captions', [], 'en')
      const video = videoWithTracks(english)

      const promise = cuesFromTextTracksWhenReady(video, { intervalMs: 100, deadlineMs: 1000 })
      // The first (synchronous) read already ran and found nothing; the loop
      // is now waiting on its first tick. Populate the cue before that tick
      // fires so the second read finds it.
      english.cues.push({ startTime: 0, endTime: 2, text: 'hello' })
      await vi.advanceTimersByTimeAsync(100)

      expect(await promise).toEqual([{ start: 0, end: 2, text: 'hello' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('trả cue ngay nếu chỉ có một track không gắn nhãn ngôn ngữ, không cần chờ', async () => {
    // No English track exists at all here, so nothing should hold this up
    // waiting for one — the fix for the latency this poll used to add to
    // the single-track case.
    const untagged = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'hello' }])
    const video = videoWithTracks(untagged)

    const cues = await cuesFromTextTracksWhenReady(video)

    expect(cues).toEqual([{ start: 0, end: 2, text: 'hello' }])
  })

  it('hết hạn thì trả về bất kỳ cue nào đang có, kể cả không phải tiếng Anh, nếu track tiếng Anh không bao giờ có cue', async () => {
    vi.useFakeTimers()
    try {
      // An English track exists (so the poll keeps requiring it) but never
      // produces cues; Spanish has cues from the start. Only once the
      // deadline passes should Spanish be accepted.
      const spanish = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'hola' }], 'es')
      const english = fakeTrack('captions', [], 'en')
      const video = videoWithTracks(spanish, english)

      const promise = cuesFromTextTracksWhenReady(video, { intervalMs: 100, deadlineMs: 300 })
      await vi.advanceTimersByTimeAsync(300)

      expect(await promise).toEqual([{ start: 0, end: 2, text: 'hola' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('hết hạn mà không có track nào thì trả mảng rỗng', async () => {
    vi.useFakeTimers()
    try {
      const video = videoWithTracks()

      const promise = cuesFromTextTracksWhenReady(video, { intervalMs: 100, deadlineMs: 300 })
      await vi.advanceTimersByTimeAsync(300)

      expect(await promise).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('chờ track tiếng Anh thay vì lấy track tiếng Tây Ban Nha đã có cue trước', async () => {
    vi.useFakeTimers()
    try {
      // The exact case that broke R4 in the real path: Spanish already has
      // cues; taking the first non-empty read would segment the lecture
      // from Spanish and send it to the translator as if it were English.
      const spanish = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'hola' }], 'es')
      const english = fakeTrack('captions', [], 'en')
      const video = videoWithTracks(spanish, english)

      const promise = cuesFromTextTracksWhenReady(video, { intervalMs: 100, deadlineMs: 1000 })
      english.cues.push({ startTime: 0, endTime: 2, text: 'hello' })
      await vi.advanceTimersByTimeAsync(100)

      expect(await promise).toEqual([{ start: 0, end: 2, text: 'hello' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('bỏ vòng chờ ngay khi abortWhen báo true, trả mảng rỗng', async () => {
    vi.useFakeTimers()
    try {
      const english = fakeTrack('captions', [], 'en')
      const video = videoWithTracks(english)
      let aborted = false

      const promise = cuesFromTextTracksWhenReady(video, {
        intervalMs: 100,
        deadlineMs: 1000,
        abortWhen: () => aborted,
      })
      aborted = true
      await vi.advanceTimersByTimeAsync(100)

      expect(await promise).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  // F1: without a stricter `accept`, a <video> element whose tracks still
  // carry a *previous* lecture's cues (Udemy can reuse the same element
  // across lectures) gets those handed back immediately, as if they were
  // the new lecture's. This is the defect content.ts's lectureChanged path
  // must not hit — the next test shows the `accept` option closing it.
  it('không có accept tuỳ chỉnh thì lấy ngay cue đang có trên track, kể cả khi đó là cue còn sót lại từ bài trước', async () => {
    const stale = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'lecture A line' }], 'en')
    const video = videoWithTracks(stale)

    const cues = await cuesFromTextTracksWhenReady(video)

    expect(cues).toEqual([{ start: 0, end: 2, text: 'lecture A line' }])
  })

  it('accept từ chối chữ ký cue cũ thì không dùng nhầm cue của bài trước, và hết hạn thì trả rỗng', async () => {
    vi.useFakeTimers()
    try {
      const stale = fakeTrack('captions', [{ startTime: 0, endTime: 2, text: 'lecture A line' }], 'en')
      const video = videoWithTracks(stale)
      const staleSignature = '1|lecture A line|lecture A line'
      const signatureOf = (cues: { text: string }[]) =>
        cues.length === 0 ? '' : `${cues.length}|${cues[0].text}|${cues[cues.length - 1].text}`

      // The track never actually changes in this test (there is no lecture
      // B content to load yet), so the only correct outcome is giving up
      // empty-handed rather than handing back lecture A's leftover cues.
      const promise = cuesFromTextTracksWhenReady(video, {
        deadlineMs: 300,
        intervalMs: 100,
        accept: (cues) => cues.length > 0 && signatureOf(cues) !== staleSignature,
      })
      await vi.advanceTimersByTimeAsync(300)

      expect(await promise).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
