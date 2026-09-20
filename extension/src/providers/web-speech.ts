import { DurationEstimator } from '../core/duration-estimator'
import type { TTSProvider, Utterance } from '../core/types'

const LANG = 'vi-VN'

/** How long past the estimated reading time to wait before giving up on the
 *  engine ever reporting anything, same reasoning as audio-player.ts's
 *  watchdog. The grace here has to be looser: audio-player.ts pads a
 *  duration the server measured exactly, while `duration` here is
 *  DurationEstimator.estimate() output — a guess that can be off by the
 *  estimator's whole MIN_CPS..MAX_CPS range (a slow voice against an
 *  estimate seeded/converged for a faster one can genuinely take several
 *  times longer). ESTIMATE_SAFETY_FACTOR absorbs that before the flat grace
 *  is added for ordinary engine queuing latency. */
const ESTIMATE_SAFETY_FACTOR = 3
const WATCHDOG_GRACE_MS = 2_000

/** macOS localises the enhanced voice's qualifier; only "Linh (Nâng cao)" has
 *  been observed, on this machine (see
 *  docs/superpowers/2026-09-20-m1-verification.md). "enhanced" and "premium"
 *  are matched speculatively for other locales, not from observation. */
const ENHANCED_VOICE = /enhanced|premium|nâng cao/i

/**
 * Speaks through the browser's built-in synthesiser. Used as the fallback, and
 * as the only engine in M1 so the sync machinery can be validated before the
 * local TTS server exists.
 *
 * On macOS this reaches two Vietnamese voices — "Linh" and its enhanced
 * build, whose name is localised — and prefers the enhanced one. An earlier
 * comment here claimed only the plain voice was exposed; the M1 verification
 * run showed otherwise (docs/superpowers/2026-09-20-m1-verification.md).
 *
 * Note that on this machine speechSynthesis.speak() does nothing at all: no
 * onstart, no onend, no onerror. That is a Chrome/macOS fault, not this
 * code's, and it is why the local server is the real engine rather than an
 * upgrade. play()'s watchdog keeps that failure from wedging the scheduler
 * forever, but it does not make speech happen — on a machine in this state,
 * falling back to this provider still means no audio at all.
 */
export class WebSpeechProvider implements TTSProvider {
  readonly name = 'web-speech'
  readonly knowsDurationAhead = false

  private readonly estimator = new DurationEstimator(15)

  get charsPerSecond(): number {
    return this.estimator.charsPerSecond
  }

  async isAvailable(): Promise<boolean> {
    if (typeof speechSynthesis === 'undefined') return false
    if (this.voice() !== undefined) return true
    // Chrome returns [] from getVoices() until the voice list finishes
    // loading asynchronously after a page load. Without waiting once here,
    // the first attach on a fresh page can wrongly report "no Vietnamese
    // voice" on a machine that has one.
    if (speechSynthesis.getVoices().length === 0) await this.waitForVoices()
    return this.voice() !== undefined
  }

  /** Resolves once `voiceschanged` fires, or after `timeoutMs` if it never
   *  does (some engines never fire it at all). */
  private waitForVoices(timeoutMs = 1500): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        speechSynthesis.removeEventListener('voiceschanged', done)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      speechSynthesis.addEventListener('voiceschanged', done)
    })
  }

  private voice(): SpeechSynthesisVoice | undefined {
    if (typeof speechSynthesis === 'undefined') return undefined
    const vietnamese = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('vi'))
    return vietnamese.find((v) => ENHANCED_VOICE.test(v.name)) ?? vietnamese[0]
  }

  async prepare(text: string, signal: AbortSignal): Promise<Utterance> {
    const estimator = this.estimator
    const voice = this.voice()
    const duration = estimator.estimate(text)

    let native: SpeechSynthesisUtterance | null = null
    let startedAt = 0
    let cancelled = false

    return {
      duration,

      play(rate: number): Promise<void> {
        if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
        return new Promise<void>((resolve, reject) => {
          const u = new SpeechSynthesisUtterance(text)
          u.lang = LANG
          u.rate = rate
          if (voice) u.voice = voice
          native = u
          startedAt = Date.now()

          let settled = false
          const settle = (fn: () => void): void => {
            if (settled) return
            settled = true
            clearTimeout(watchdog)
            fn()
          }

          // The M1 verification recorded this engine firing no event at all
          // — no onstart, no onend, no onerror, forever — on this very
          // machine. Without a deadline that wedges the scheduler
          // permanently (speaking stays non-null, tick() never selects
          // again), exactly the failure audio-player.ts's own watchdog
          // exists to prevent, just on the provider that didn't get one.
          // Resolving (not rejecting) matches that reasoning: the slot is
          // over either way, and the scheduler's cleanup must run on both
          // paths.
          const watchdog = setTimeout(
            () => {
              // The reading never really completed — cut off mid-flight, or
              // never started at all — so, like the `cancelled` branch
              // below, it must not be fed to the estimator: a reading that
              // never happened would poison the running average.
              settle(resolve)
            },
            (duration / rate) * 1000 * ESTIMATE_SAFETY_FACTOR + WATCHDOG_GRACE_MS,
          )

          // The engine queues utterances, so the clock only really starts when
          // it begins speaking. Measuring from here would charge queue latency
          // to the speech and teach the estimator a rate that is too slow.
          u.onstart = () => {
            startedAt = Date.now()
          }

          u.onend = () => {
            settle(() => {
              if (cancelled) {
                // Chromium reports a mid-sentence cancel as `end`. Learning
                // from a partial reading would teach a wildly inflated rate,
                // so this observation is dropped rather than recorded.
                reject(new DOMException('cancelled', 'AbortError'))
                return
              }
              // Normalise back to rate 1.0 before feeding the estimator.
              estimator.observe(text, ((Date.now() - startedAt) / 1000) * rate)
              resolve()
            })
          }

          u.onerror = () => {
            settle(() => {
              // The spec reports a cancel as an `interrupted` error where
              // Chromium reports `end`. Either way, a cancel is not a failure.
              reject(
                cancelled
                  ? new DOMException('cancelled', 'AbortError')
                  : new Error('speech synthesis failed'),
              )
            })
          }

          speechSynthesis.speak(u)
        })
      },

      cancel(): void {
        cancelled = true
        if (native !== null) speechSynthesis.cancel()
      },
    }
  }
}
