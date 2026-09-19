import { DurationEstimator } from '../core/duration-estimator'
import type { TTSProvider, Utterance } from '../core/types'

const LANG = 'vi-VN'

/**
 * Speaks through the browser's built-in synthesiser. Used as the fallback, and
 * as the only engine in M1 so the sync machinery can be validated before the
 * local TTS server exists.
 *
 * On macOS this reaches exactly one Vietnamese voice ("Linh"); the Enhanced
 * build Apple ships is not exposed to the Web Speech API.
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
    return speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('vi'))
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

          // The engine queues utterances, so the clock only really starts when
          // it begins speaking. Measuring from here would charge queue latency
          // to the speech and teach the estimator a rate that is too slow.
          u.onstart = () => {
            startedAt = Date.now()
          }

          u.onend = () => {
            if (cancelled) {
              // Chromium reports a mid-sentence cancel as `end`. Learning from
              // a partial reading would teach a wildly inflated rate, so this
              // observation is dropped rather than recorded.
              reject(new DOMException('cancelled', 'AbortError'))
              return
            }
            // Normalise back to rate 1.0 before feeding the estimator.
            estimator.observe(text, ((Date.now() - startedAt) / 1000) * rate)
            resolve()
          }

          u.onerror = () => {
            // The spec reports a cancel as an `interrupted` error where
            // Chromium reports `end`. Either way, a cancel is not a failure.
            reject(
              cancelled
                ? new DOMException('cancelled', 'AbortError')
                : new Error('speech synthesis failed'),
            )
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
