import type { TTSProvider, Utterance } from '../core/types'
import { createAudioPlayer, type AudioPlayer } from './audio-player'

type SendMessage = (message: unknown) => Promise<unknown>

export interface VieNeuOptions {
  /** Defaults to chrome.runtime.sendMessage. Injected so the provider is
   *  testable without an extension runtime. */
  send?: SendMessage
  createPlayer?: (wavBase64: string, duration: number) => AudioPlayer
}

interface SpeakReply {
  audio?: string
  duration?: number
  error?: string
}

const abortError = (): DOMException => new DOMException('aborted', 'AbortError')

/**
 * Speaks through the local VieNeu server. The synthesis itself happens in
 * the service worker (spec 4.1, 8.3); this side sends the text, receives
 * base64 WAV and an exact duration, and owns playback because playback has
 * to sit next to the video.
 */
export class VieNeuProvider implements TTSProvider {
  readonly name = 'vieneu'
  /** The server reports the exact length in X-Audio-Duration, so the
   *  scheduler never has to estimate — unlike Web Speech. */
  readonly knowsDurationAhead = true

  private readonly send: SendMessage
  private readonly createPlayer: (wavBase64: string, duration: number) => AudioPlayer

  constructor(opts: VieNeuOptions = {}) {
    this.send = opts.send ?? ((message) => chrome.runtime.sendMessage(message))
    this.createPlayer = opts.createPlayer ?? createAudioPlayer
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = (await this.send({ type: 'tts-health' })) as { ok?: boolean } | undefined
      return res?.ok === true
    } catch {
      // sendMessage rejects when the service worker is recycled mid-request
      // or the port closes. Unreachable is unavailable.
      return false
    }
  }

  /**
   * Synthesises one throwaway sentence so the server's start-up cost is paid
   * before a real sentence needs it: 4.3s to load the model, then about 1.8s
   * for the first inference regardless of length — roughly six seconds that
   * would otherwise land on the first sentence of the lecture.
   *
   * Best-effort. A failure here is not a reason to stop attaching: the real
   * availability answer came from isAvailable().
   */
  async warmUp(): Promise<void> {
    try {
      const utterance = await this.prepare('Xin chào.', new AbortController().signal)
      utterance.cancel()
    } catch {
      // Intentionally swallowed — see above.
    }
  }

  async prepare(text: string, signal: AbortSignal): Promise<Utterance> {
    if (signal.aborted) throw abortError()

    const res = (await this.send({ type: 'tts-speak', text })) as SpeakReply | undefined
    if (res?.error) throw new Error(res.error)
    if (typeof res?.audio !== 'string' || typeof res?.duration !== 'number') {
      throw new Error('TTS reply is malformed')
    }

    const player = this.createPlayer(res.audio, res.duration)

    // The round trip takes long enough for a seek to land inside it. Building
    // the player already allocated a blob URL, so it has to be released
    // rather than simply dropped.
    if (signal.aborted) {
      player.cancel()
      throw abortError()
    }

    let cancelled = false
    return {
      duration: res.duration,

      play(rate: number): Promise<void> {
        if (cancelled || signal.aborted) return Promise.reject(abortError())
        return player.play(rate)
      },

      cancel(): void {
        cancelled = true
        player.cancel()
      },
    }
  }
}
