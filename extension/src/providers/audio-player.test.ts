import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioPlayer } from './audio-player'

/** Stands in for HTMLAudioElement. Node has no `Audio`, and jsdom's
 *  HTMLMediaElement throws "Not implemented" on play() and never fires
 *  `ended`, so neither environment can exercise this for real — the e2e run
 *  in Task 9 is what proves the genuine element works. */
class FakeAudio {
  static last: FakeAudio | null = null
  playbackRate = 1
  preservesPitch = false
  paused = false
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playCalls = 0
  pauseCalls = 0
  playRejection: Error | null = null

  constructor(readonly src: string) {
    FakeAudio.last = this
  }

  play(): Promise<void> {
    this.playCalls++
    return this.playRejection ? Promise.reject(this.playRejection) : Promise.resolve()
  }

  pause(): void {
    this.pauseCalls++
    this.paused = true
  }
}

// "RIFF" in base64 — enough to stand in for a WAV body.
const WAV = 'UklGRg=='

describe('createAudioPlayer', () => {
  let revoke: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    FakeAudio.last = null
    vi.stubGlobal('Audio', FakeAudio)
    revoke = vi.spyOn(URL, 'revokeObjectURL')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('bật preservesPitch và đặt tốc độ được yêu cầu', async () => {
    const player = createAudioPlayer(WAV, 1)
    void player.play(1.3)
    await Promise.resolve()

    expect(FakeAudio.last?.preservesPitch).toBe(true)
    expect(FakeAudio.last?.playbackRate).toBe(1.3)
    expect(FakeAudio.last?.playCalls).toBe(1)
  })

  it('resolve khi audio phát xong, và trả lại blob URL', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    FakeAudio.last?.onended?.()
    await expect(done).resolves.toBeUndefined()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('cancel làm play reject bằng AbortError và dừng phần tử', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    player.cancel()

    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeAudio.last?.pauseCalls).toBe(1)
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('reject khi phần tử báo lỗi', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    FakeAudio.last?.onerror?.()
    await expect(done).rejects.toThrow('audio playback failed')
  })

  it('reject khi play() bị chính sách autoplay chặn', async () => {
    const player = createAudioPlayer(WAV, 1)
    const el = () => FakeAudio.last!
    // Constructed first so the rejection can be armed before play() runs.
    el().playRejection = new DOMException('blocked', 'NotAllowedError')

    await expect(player.play(1)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('tự kết thúc khi phần tử không bao giờ báo gì', async () => {
    // M1's Web Speech failure was exactly this: no onstart, no onend, no
    // onerror, just silence — and because nothing downstream had a deadline,
    // the scheduler would have waited for the rest of the lecture. The
    // duration is known exactly here, so waiting past it is provably wrong.
    vi.useFakeTimers()
    const player = createAudioPlayer(WAV, 4)
    const done = player.play(2)
    await Promise.resolve()

    // 4s of audio at rate 2 is 2s of wall clock, plus the 2s grace.
    vi.advanceTimersByTime(4_001)
    await expect(done).resolves.toBeUndefined()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('giải phóng blob URL đúng một lần dù cancel sau khi đã xong', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    FakeAudio.last?.onended?.()
    await done
    player.cancel()

    expect(revoke).toHaveBeenCalledTimes(1)
  })
})
