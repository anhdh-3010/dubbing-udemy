/** A prepared WAV, ready to play once. Not reusable: `play` is called at
 *  most once per instance, and the blob URL is released when it settles. */
export interface AudioPlayer {
  /** Resolves when playback finishes. Rejects with AbortError if cancelled. */
  play(rate: number): Promise<void>
  cancel(): void
}

/** How long past the audio's own length to wait before giving up on the
 *  element ever reporting anything. */
const WATCHDOG_GRACE_MS = 2_000

function toBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Wraps base64 WAV bytes in something the scheduler can play and cancel.
 *
 * `duration` is the exact length the server reported. It is not used to time
 * playback — the element does that — only to arm the watchdog below.
 */
export function createAudioPlayer(wavBase64: string, duration: number): AudioPlayer {
  const url = URL.createObjectURL(new Blob([toBytes(wavBase64)], { type: 'audio/wav' }))
  const audio = new Audio(url)
  // Speed up without raising the pitch. Default is already true in Chrome;
  // set explicitly because spec 6.2's rate clamp of 1.4 is only tolerable
  // with it on, and a silent default change would be hard to trace.
  audio.preservesPitch = true

  let settled = false
  let cancelled = false
  // Typed from the call rather than as `number`: "node" is in tsconfig's
  // `types`, so setTimeout resolves to Node's overload here, and this module
  // is unit-tested under the `node` environment where `window` does not exist.
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let rejectPlay: ((reason: unknown) => void) | null = null

  const release = (): void => {
    if (settled) return
    settled = true
    clearTimeout(watchdog)
    URL.revokeObjectURL(url)
  }

  return {
    play(rate: number): Promise<void> {
      if (cancelled) {
        return Promise.reject(new DOMException('cancelled', 'AbortError'))
      }
      audio.playbackRate = rate

      return new Promise<void>((resolve, reject) => {
        rejectPlay = reject

        const finish = (): void => {
          release()
          resolve()
        }
        const fail = (reason: unknown): void => {
          release()
          reject(reason)
        }

        audio.onended = finish
        audio.onerror = () => fail(new Error('audio playback failed'))

        // M1's Web Speech failure was an engine that fired no event at all,
        // and nothing downstream had a deadline, so the scheduler would have
        // waited out the lecture. Here the exact length is known, so waiting
        // past it is provably wrong rather than merely suspicious. Resolving
        // (not rejecting) is right: the slot is over either way, and the
        // scheduler's cleanup runs on both paths.
        watchdog = setTimeout(finish, (duration / rate) * 1000 + WATCHDOG_GRACE_MS)

        audio.play().catch(fail)
      })
    },

    cancel(): void {
      cancelled = true
      audio.pause()
      audio.onended = null
      audio.onerror = null
      release()
      rejectPlay?.(new DOMException('cancelled', 'AbortError'))
      rejectPlay = null
    },
  }
}
