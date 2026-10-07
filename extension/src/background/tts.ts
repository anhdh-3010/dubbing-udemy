/**
 * The service worker's half of the TTS path.
 *
 * Spec 4.1 puts every network call in the service worker. Spec 8.3 says why
 * that matters here in particular: the local server answers `chrome-extension://`
 * origins only, and widening it so the content script could call the server
 * directly would hand every script running on the lecture page — Udemy's own
 * and its third parties' — a speech synthesiser on this machine.
 */

/**
 * Where the local VieNeu server listens.
 *
 * Hardcoded, and never read out of a message: a content script that has been
 * compromised must not get to choose which host the service worker calls.
 * The options page gains a field for this in M3 (spec 12), and that is when
 * `isLoopbackHttpUrl` stops being a formality and starts guarding real input.
 *
 * An `e2e` build points at the stub in scripts/serve-fixtures.mjs instead: the
 * real server holds port 8770 permanently under launchd, so an e2e run cannot
 * bind it. Same mechanism as the fixture origin in wxt.config.ts's
 * `build:manifestGenerated` hook, and `http://127.0.0.1/*` in host_permissions
 * covers both ports because match patterns ignore the port.
 */
export const TTS_BASE_URL =
  import.meta.env.MODE === 'e2e' ? 'http://127.0.0.1:5599' : 'http://127.0.0.1:8770'

export const TTS_VOICE = 'Hải Đăng'
/** Ignored by the Turbo server, which has no steps setting. Still sent and
 *  still part of the audio cache key (cache-policy.ts), so changing it would
 *  only throw away cached audio for nothing. */
export const TTS_STEPS = 8

const HEALTH_TIMEOUT_MS = 2_000
/** A 12-second sentence takes about 2.7s to synthesise once the model is
 *  warm, and about 9s on the very first call after the server starts. 30s is
 *  not a performance budget — it is the line past which something is wrong. */
const SPEECH_TIMEOUT_MS = 30_000

export interface SynthesisResult {
  /** Raw WAV bytes. Base64 is applied at the message boundary, not here:
   *  `chrome.runtime.sendMessage` serialises with JSON so an ArrayBuffer
   *  would arrive as `{}` (spec 8.3) — but the cache stores these bytes as
   *  they are, and base64 would cost it a third of its quota.
   *
   *  The `<ArrayBuffer>` argument is load-bearing under this repo's
   *  TypeScript: the default `Uint8Array<ArrayBufferLike>` does not satisfy
   *  `BlobPart`, and its `.buffer` is not an `ArrayBuffer` (M2, Ruling 9). */
  wav: Uint8Array<ArrayBuffer>
  /** Seconds, exact, from the server's X-Audio-Duration header. */
  duration: number
}

export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

export function toBase64(bytes: Uint8Array): string {
  // btoa wants a binary string. String.fromCharCode(...bytes) spreads every
  // byte as an argument and throws "Maximum call stack size exceeded" on
  // anything this size, so the buffer is walked in chunks.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Whether the local server is answering. Never throws: "the server is not
 *  there" is the answer this question exists to give. */
export async function ttsHealth(
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = TTS_BASE_URL,
): Promise<boolean> {
  if (!isLoopbackHttpUrl(baseUrl)) return false
  try {
    const res = await fetchImpl(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function synthesize(
  text: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = TTS_BASE_URL,
): Promise<SynthesisResult> {
  if (!isLoopbackHttpUrl(baseUrl)) {
    throw new Error(`TTS base URL is not loopback: ${baseUrl}`)
  }

  const res = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: text, voice: TTS_VOICE, steps: TTS_STEPS }),
    signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`TTS request failed: ${res.status}`)

  const duration = Number(res.headers.get('X-Audio-Duration'))
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('TTS response is missing X-Audio-Duration')
  }

  const wav = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>
  return { wav, duration }
}
