import { computeStretch } from './rate'
import { isReady, type Segment, type TTSProvider, type Utterance, type VideoLike } from './types'

export interface SchedulerOptions {
  video: VideoLike
  provider: TTSProvider
  /** Original audio level while the dub is speaking. */
  duckVolume?: number
}

/** A segment whose start is further behind than this is skipped, not chased. */
const MAX_LATENESS = 1.5

export class Scheduler {
  private readonly video: VideoLike
  private readonly provider: TTSProvider
  private readonly duckVolume: number

  private segments: Segment[] = []
  private spoken = new Set<number>()
  private baseline = 1
  private originalVolume = 1

  private speaking: { utterance: Utterance; controller: AbortController } | null = null

  constructor(opts: SchedulerOptions) {
    this.video = opts.video
    this.provider = opts.provider
    this.duckVolume = opts.duckVolume ?? 0.1
  }

  setSegments(segments: Segment[]): void {
    this.segments = segments
  }

  /** Records the speed the viewer chose. All stretching is relative to it. */
  setBaseline(rate: number): void {
    this.baseline = rate > 0 ? rate : 1
  }

  onSeek(): void {
    this.cancelCurrent()
    // Anything after the new position may be spoken again.
    this.spoken.clear()
  }

  stop(): void {
    this.cancelCurrent()
  }

  /** Drives one frame. The content script calls this from requestAnimationFrame. */
  async tick(): Promise<void> {
    if (this.speaking !== null || this.video.paused) return

    const now = this.video.currentTime
    const index = this.segments.findIndex(
      (s) => !this.spoken.has(s.id) && now >= s.start && now < s.end,
    )
    if (index === -1) return

    const segment = this.segments[index]
    if (now - segment.start > MAX_LATENESS) {
      this.spoken.add(segment.id)
      return
    }
    if (!isReady(segment)) {
      // Not translated yet: let the original audio play at full volume.
      this.spoken.add(segment.id)
      return
    }

    this.spoken.add(segment.id)
    await this.speak(segment, this.segments[index + 1])
  }

  private async speak(segment: Segment & { viText: string }, next: Segment | undefined): Promise<void> {
    const controller = new AbortController()
    let utterance: Utterance
    try {
      utterance = await this.provider.prepare(segment.viText, controller.signal)
    } catch {
      return
    }

    const plan = computeStretch({
      segmentStart: segment.start,
      segmentEnd: segment.end,
      gapAfter: next ? Math.max(0, next.start - segment.end) : 0,
      duration: utterance.duration,
      baseline: this.baseline,
    })

    this.speaking = { utterance, controller }
    this.originalVolume = this.video.volume
    this.video.volume = this.duckVolume
    this.video.playbackRate = plan.videoRate

    // Start speaking but do not await it: tick() has to return so the next
    // frame can run. The `speaking` guard is what prevents overlap.
    void utterance
      .play(plan.ttsRate)
      .catch(() => {
        // Cancelled mid-sentence; restoring below is still correct.
      })
      .finally(() => {
        if (this.speaking?.utterance === utterance) this.restore()
      })
  }

  private restore(): void {
    this.speaking = null
    this.video.volume = this.originalVolume
    this.video.playbackRate = this.baseline
  }

  private cancelCurrent(): void {
    if (this.speaking === null) return
    this.speaking.controller.abort()
    this.speaking.utterance.cancel()
    this.restore()
  }
}
