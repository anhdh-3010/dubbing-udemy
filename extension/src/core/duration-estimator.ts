const MIN_CPS = 5
const MAX_CPS = 40
/** Weight of each new observation in the moving average. */
const ALPHA = 0.2
const MIN_DURATION = 0.15

/**
 * Web Speech cannot report how long an utterance will take, so the scheduler
 * estimates it from character count and corrects the rate after each sentence.
 * A few sentences are enough to converge on the viewer's voice and machine.
 */
export class DurationEstimator {
  private cps: number

  constructor(initialCharsPerSecond = 15) {
    this.cps = initialCharsPerSecond
  }

  get charsPerSecond(): number {
    return this.cps
  }

  estimate(text: string): number {
    return Math.max(MIN_DURATION, text.length / this.cps)
  }

  observe(text: string, actualSeconds: number): void {
    if (text.length === 0 || actualSeconds <= 0) return
    const observed = text.length / actualSeconds
    if (!Number.isFinite(observed)) return
    const blended = this.cps * (1 - ALPHA) + observed * ALPHA
    this.cps = Math.min(MAX_CPS, Math.max(MIN_CPS, blended))
  }
}
