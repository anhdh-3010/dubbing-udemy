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
    return this.voice() !== undefined
  }

  private voice(): SpeechSynthesisVoice | undefined {
    return speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('vi'))
  }

  async prepare(text: string, signal: AbortSignal): Promise<Utterance> {
    const estimator = this.estimator
    const voice = this.voice()
    const duration = estimator.estimate(text)

    let native: SpeechSynthesisUtterance | null = null
    let startedAt = 0

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

          u.onend = () => {
            // Normalise back to rate 1.0 before feeding the estimator.
            estimator.observe(text, ((Date.now() - startedAt) / 1000) * rate)
            resolve()
          }
          u.onerror = () => reject(new Error('speech synthesis failed'))

          speechSynthesis.speak(u)
        })
      },

      cancel(): void {
        if (native !== null) speechSynthesis.cancel()
      },
    }
  }
}
