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

/** How far ahead of the playhead a sentence may be synthesised, in seconds
 *  of video time. Spec 6.5: exactly one sentence is held at a time, so this
 *  only decides how early that one may start. */
const PREFETCH_LEAD = 10

/** A sentence being synthesised ahead of its slot. */
interface Prefetched {
  id: number
  controller: AbortController
  promise: Promise<Utterance>
}

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
  /** The one sentence prepared ahead of its slot, if any (spec 6.5). */
  private prefetched: Prefetched | null = null

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

  /** The video paused. Stop the dub from talking over a frozen frame, but —
   *  unlike onSeek() — leave `spoken` untouched: the viewer already heard
   *  this segment start, so resuming at the same position must not replay
   *  it. tick() already won't re-select an id still in `spoken`. */
  onPause(): void {
    this.generation++
    this.cancelCurrent()
  }

  stop(): void {
    this.stopped = true
    this.generation++
    this.cancelCurrent()
  }

  /** Drives one frame. The content script calls this from requestAnimationFrame. */
  async tick(): Promise<void> {
    if (this.stopped || this.video.paused) return

    if (!this.starting && this.speaking === null) {
      const now = this.video.currentTime
      const index = this.segments.findIndex(
        (s) => !this.spoken.has(s.id) && now >= s.start && now < s.end,
      )

      if (index !== -1) {
        const segment = this.segments[index]
        if (now - segment.start > MAX_LATENESS) {
          this.spoken.add(segment.id)
        } else if (!isReady(segment)) {
          // Not translated yet: let the original audio play at full volume.
          this.spoken.add(segment.id)
        } else {
          this.spoken.add(segment.id)
          this.starting = true
          try {
            await this.speak(segment, this.segments[index + 1])
          } finally {
            this.starting = false
          }
          // The urgent prepare this just issued must never queue behind a
          // speculative one on the local server, which serialises requests
          // (measured: a concurrent second request waits for the first).
          // Returning here means this tick prepares only the segment that
          // was just selected; the next sentence is prefetched starting on
          // the next frame, ~16ms later, while this one is being spoken.
          return
        }
      }
    }

    // Reached whenever nothing was selected this frame: nothing is due yet,
    // a segment was just skipped (falling through here, rather than
    // returning above, starts its replacement's prefetch immediately
    // instead of a frame late), or a sentence is already being
    // prepared/spoken and the guard above skipped selection entirely — the
    // moment to look ahead in every case.
    this.maybePrefetch()
  }

  private maybePrefetch(): void {
    const now = this.video.currentTime
    const held = this.prefetched
    if (held !== null) {
      const segment = this.segments.find((s) => s.id === held.id)
      // A held entry is dead once selection can never pick it again: its
      // segment was replaced (setSegments), tick() already marked it spoken
      // (skipped for lateness or for not being translated), or its slot
      // ended without ever being selected at all — a long sentence
      // overrunning into the next slot, or a hidden tab suspending
      // requestAnimationFrame while the video kept playing, both step the
      // playhead over a whole slot with no seek and no tick in between.
      if (segment === undefined || this.spoken.has(held.id) || now >= segment.end) {
        this.discardPrefetch()
      } else {
        return
      }
    }

    const next = this.segments.find(
      (s): s is Segment & { viText: string } =>
        isReady(s) &&
        !this.spoken.has(s.id) &&
        s.start > now &&
        s.end > now &&
        s.start - now <= PREFETCH_LEAD,
    )
    if (next === undefined) return

    const generation = this.generation
    const controller = new AbortController()
    const entry: Prefetched = {
      id: next.id,
      controller,
      promise: this.provider.prepare(next.viText, controller.signal),
    }
    this.prefetched = entry

    entry.promise.then(
      (utterance) => {
        // Consumed by speak(), or already discarded — either way not ours.
        if (this.prefetched !== entry) return
        // Currently unreachable: this can only be true if `generation`
        // changed while `this.prefetched` still === entry, but all three
        // sites that bump generation (onSeek, onPause, stop) do it via
        // cancelCurrent(), which calls discardPrefetch() synchronously —
        // and discardPrefetch() nulls `this.prefetched` before this .then()
        // callback ever gets to run, so the guard above already returned.
        // It would become live if a future generation bump ever landed
        // without going through cancelCurrent()/discardPrefetch() first.
        // Kept rather than deleted so that path stays safe if it ever
        // opens up, rather than silently leaking a blob URL.
        if (generation !== this.generation) {
          // A seek landed while this was in flight. It belongs to a position
          // the viewer has left, and the real provider is holding a blob URL
          // that leaks unless somebody releases it.
          this.prefetched = null
          utterance.cancel()
        }
      },
      () => {
        // Synthesis failed. Forget it rather than remembering the failure:
        // speak() will try live when the slot arrives, and FallbackProvider
        // has already recorded what this means for engine health.
        if (this.prefetched === entry) this.prefetched = null
      },
    )
  }

  private discardPrefetch(): void {
    const held = this.prefetched
    if (held === null) return
    this.prefetched = null
    held.controller.abort()
    held.promise.then(
      (utterance) => utterance.cancel(),
      () => {
        // Already failed; nothing to release.
      },
    )
  }

  private async speak(
    segment: Segment & { viText: string },
    next: Segment | undefined,
  ): Promise<void> {
    const generation = this.generation
    const taken = await this.take(segment)
    if (taken === null) return
    const { utterance, controller } = taken

    if (generation !== this.generation) {
      // A seek or a stop landed while the provider was preparing. This speech
      // belongs to a position the viewer has already left.
      utterance.cancel()
      return
    }

    const plan = computeStretch({
      // Read now, not at tick()'s selection time: take() just awaited
      // provider.prepare(), which is ~0.8s on the real server whenever
      // there is no usable prefetch to reuse (the first sentence after a
      // seek, a discarded/failed prefetch, a translation that lands inside
      // its own slot). Planning from the pre-wait reading would credit the
      // budget with time that has already elapsed by the time speech
      // actually starts, understretching by that same ~0.8s — the exact
      // failure mode spec 6.5 describes, just moved from "at all" to
      // "usually masked by prefetch". Harmless on the prefetched path,
      // where take() resolves immediately and the two readings coincide.
      segmentStart: Math.max(segment.start, this.video.currentTime),
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

  /** The utterance for this segment: the one prepared ahead if it is the
   *  right one, otherwise a fresh synthesis. Null when preparation failed —
   *  the slot then plays the original audio at full volume (spec 10).
   *
   *  Returns the controller alongside the utterance, not just the utterance:
   *  `speaking` needs it (see cancelCurrent()), and it differs depending on
   *  whether this call reused a prefetch or started a fresh prepare(). */
  private async take(
    segment: Segment & { viText: string },
  ): Promise<{ utterance: Utterance; controller: AbortController } | null> {
    const held = this.prefetched
    const usable = held !== null && held.id === segment.id ? held : null
    if (usable !== null) this.prefetched = null

    // A prefetch for a *different* segment is left alone. Usually that
    // prefetch IS the upcoming sentence maybePrefetch() would pick again —
    // but not always: if a segment nearer than the held one was still
    // `pending` when the prefetch was issued and turned `ready` before its
    // own slot arrived, that nearer segment gets a live synthesis here
    // instead of reusing anything, and the held prefetch stays queued for
    // the sentence after it.
    const controller = usable?.controller ?? new AbortController()
    const promise = usable?.promise ?? this.provider.prepare(segment.viText, controller.signal)

    this.preparing = controller
    try {
      const utterance = await promise
      return { utterance, controller }
    } catch {
      return null
    } finally {
      if (this.preparing === controller) this.preparing = null
    }
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
    // Pausing throws away a prepared sentence too, so resuming re-synthesises
    // it — about half a second on the real provider. Keeping it across a
    // pause would mean tracking whether the viewer resumed at the same place,
    // which is not worth half a second.
    this.discardPrefetch()
    if (this.speaking === null) return
    this.speaking.controller.abort()
    this.speaking.utterance.cancel()
    this.restore()
  }
}
