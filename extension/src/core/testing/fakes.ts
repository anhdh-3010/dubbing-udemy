import type { TTSProvider, Utterance, VideoLike } from '../types'

export class FakeVideo implements VideoLike {
  currentTime = 0
  playbackRate = 1
  volume = 1
  paused = false
}

export class FakeUtterance implements Utterance {
  played = false
  cancelled = false
  rateUsed: number | null = null
  private resolve: (() => void) | null = null

  constructor(readonly duration: number) {}

  play(rate: number): Promise<void> {
    this.played = true
    this.rateUsed = rate
    return new Promise<void>((res) => {
      this.resolve = res
    })
  }

  /** Test helper: end the utterance as if speech finished. */
  finish(): void {
    this.resolve?.()
    this.resolve = null
  }

  cancel(): void {
    this.cancelled = true
    this.resolve?.()
    this.resolve = null
  }
}

export class FakeTTS implements TTSProvider {
  readonly name = 'fake'
  readonly knowsDurationAhead = true
  readonly prepared: FakeUtterance[] = []
  /** Every text prepare() was asked for, in order. Counting utterances is
   *  not enough once the scheduler prepares ahead: the question becomes
   *  *which* sentence was prepared, not how many. */
  readonly texts: string[] = []

  /** Seconds of speech to report for any text. */
  constructor(
    private durationFor: (text: string) => number = () => 1,
    private prepareDelayMs = 0,
  ) {}

  async isAvailable(): Promise<boolean> {
    return true
  }

  async prepare(text: string): Promise<Utterance> {
    this.texts.push(text)
    if (this.prepareDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.prepareDelayMs))
    }
    const u = new FakeUtterance(this.durationFor(text))
    this.prepared.push(u)
    return u
  }
}
