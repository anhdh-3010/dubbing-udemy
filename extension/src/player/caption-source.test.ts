import { describe, expect, it } from 'vitest'
import { cuesFromTextTracks } from './caption-source'

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

function fakeTrack(kind: string, cues: FakeCue[], language = '') {
  return { kind, mode: 'disabled', cues, language }
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
})
