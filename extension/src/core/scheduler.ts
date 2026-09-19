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
  /** True from the moment tick() commits to a segment until speech starts or
   *  fails. `speaking` cannot cover that window: it is only set once the
   *  provider has resolved, and a provider that reaches the network keeps that
   *  window open for many frames. */
  private starting = false
  /** Bumped by onSeek() and stop(), so speech prepared for a position the
   *  viewer has left is discarded instead of played. */
  private generation = 0
  private stopped = false
  /** The playbackRate this scheduler last wrote, so a driver can tell its own
   *  ratechange events from the viewer's. */
  private lastWrittenRate: number | null = null
  /** The AbortController of a prepare() that has not resolved yet. */
  private preparing: AbortController | null = null

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

  /** True when `rate` is one this scheduler wrote itself, consumed on match:
   *  each write produces at most one ratechange, so a claim is good once. */
  isOwnRate(rate: number): boolean {
    if (this.lastWrittenRate === null || rate !== this.lastWrittenRate) return false
    this.lastWrittenRate = null
    return true
  }

  onSeek(): void {
    this.generation++
    this.cancelCurrent()
    // Everything becomes speakable again: the viewer may have gone backwards.
    this.spoken.clear()
  }

  stop(): void {
    this.stopped = true
    this.generation++
    this.cancelCurrent()
  }

  /** Drives one frame. The content script calls this from requestAnimationFrame. */
  async tick(): Promise<void> {
    if (this.stopped || this.starting || this.speaking !== null || this.video.paused) return

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
    this.starting = true
    try {
      await this.speak(segment, this.segments[index + 1], now)
    } finally {
      this.starting = false
    }
  }

  private async speak(
    segment: Segment & { viText: string },
    next: Segment | undefined,
    now: number,
  ): Promise<void> {
    const generation = this.generation
    const controller = new AbortController()
    let utterance: Utterance

    this.preparing = controller
    try {
      utterance = await this.provider.prepare(segment.viText, controller.signal)
    } catch {
      return
    } finally {
      if (this.preparing === controller) this.preparing = null
    }

    if (generation !== this.generation) {
      // A seek or a stop landed while the provider was preparing. This speech
      // belongs to a position the viewer has already left.
      utterance.cancel()
      return
    }

    const plan = computeStretch({
      // The budget is what is left of the slot from where we actually start,
      // not what it was before we fell behind. tick() admits starts up to
      // MAX_LATENESS late, and planning from segment.start would hand those
      // starts time they no longer have.
      segmentStart: Math.max(segment.start, now),
      segmentEnd: segment.end,
      gapAfter: next ? Math.max(0, next.start - segment.end) : 0,
      duration: utterance.duration,
      baseline: this.baseline,
    })

    this.speaking = { utterance, controller }
    this.originalVolume = this.video.volume
    this.video.volume = this.duckVolume
    this.setRate(plan.videoRate)

    // Start speaking but do not await it: tick() has to return so the next
    // frame can run. The `speaking` and `starting` guards prevent overlap.
    void utterance
      .play(plan.ttsRate)
      .catch(() => {
        // Cancelled mid-sentence; restoring below is still correct.
      })
      .finally(() => {
        if (this.speaking?.utterance === utterance) this.restore()
      })
  }

  private setRate(rate: number): void {
    // An assignment that changes nothing fires no ratechange, so it must not
    // leave a claim behind for a later genuine change to match.
    if (this.video.playbackRate === rate) return
    this.video.playbackRate = rate
    // Read back: a clamp must not leave a claim for a rate the video never took.
    this.lastWrittenRate = this.video.playbackRate
  }

  private restore(): void {
    this.speaking = null
    this.video.volume = this.originalVolume
    this.setRate(this.baseline)
  }

  private cancelCurrent(): void {
    this.preparing?.abort()
    if (this.speaking === null) return
    this.speaking.controller.abort()
    this.speaking.utterance.cancel()
    this.restore()
  }
}
