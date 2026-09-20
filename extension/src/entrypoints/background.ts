import { InvalidApiKeyError, MODEL_ID, PermanentApiError, TARGET_LANG, translateBatch } from '../background/gemini'
import { getTranslations, putTranslations, type TranslationInput } from '../background/cache'
import { synthesize, ttsHealth } from '../background/tts'
import { isCaptionUrlAllowed } from '../player/caption-hook'
import { translationKey } from '../core/cache-policy'
import type { Segment } from '../core/types'

export interface TranslateRequest {
  type: 'translate'
  batch: Segment[]
  /** Which lecture these segments came from. Not part of the cache key —
   *  keys are content-addressed — but stored on each row so M3b can show and
   *  clear what a lecture has cached. */
  lectureId: string
}

/** Asked once per lecture, before any batch is sent to the LLM: which of
 *  these segments does the cache already know? Everything it answers is
 *  marked ready by the content script, so `planBatches` never puts it in a
 *  request. A fully cached lecture therefore costs zero API calls. */
export interface CacheLookupRequest {
  type: 'cache-lookup'
  segments: { id: number; srcText: string }[]
}

export interface CacheLookupResponse {
  translations: [number, string][]
}

export interface FetchCaptionRequest {
  type: 'fetch-caption'
  url: string
}

export interface TtsHealthRequest {
  type: 'tts-health'
}

export interface TtsSpeakRequest {
  type: 'tts-speak'
  text: string
}

/**
 * The `translate` response contract. Shared with content.ts (as a type-only
 * import, erased at build time) so the two sides can't drift apart on what
 * `fatal` means — a divergence becomes a compile error instead of a runtime
 * surprise.
 */
export interface TranslateResponse {
  translations?: [number, string][]
  error?: string
  /** Set for errors not worth continuing past (missing/rejected API key). */
  fatal?: boolean
}

export interface TtsHealthResponse {
  ok: boolean
}

/** Mirrors SynthesisResult on success. `error` is set instead on failure —
 *  the content script treats that as "this sentence gets no dub", not as
 *  "the lecture is over" (spec 10). */
export interface TtsSpeakResponse {
  audio?: string
  duration?: number
  error?: string
}

type Request =
  | TranslateRequest
  | FetchCaptionRequest
  | TtsHealthRequest
  | TtsSpeakRequest
  | CacheLookupRequest

/** Cache keys for a run of segments, in the same order. Kept as a separate
 *  step from the lookup so the mapping back to segment ids stays positional
 *  and obvious — two segments with identical source text share a key, and
 *  both must come back answered. */
function keysFor(segments: readonly { srcText: string }[]): Promise<string[]> {
  return Promise.all(segments.map((s) => translationKey(s.srcText, TARGET_LANG, MODEL_ID)))
}

async function lookupCached(
  segments: readonly { id: number; srcText: string }[],
): Promise<CacheLookupResponse> {
  if (segments.length === 0) return { translations: [] }
  const keys = await keysFor(segments)
  const found = await getTranslations(keys)

  const translations: [number, string][] = []
  for (const [i, key] of keys.entries()) {
    const vi = found.get(key)
    if (vi !== undefined) translations.push([segments[i].id, vi])
  }
  return { translations }
}

async function cacheTranslations(
  batch: readonly Segment[],
  translated: ReadonlyMap<number, string>,
  lectureId: string,
): Promise<void> {
  const keys = await keysFor(batch)
  const rows: TranslationInput[] = []
  for (const [i, seg] of batch.entries()) {
    const vi = translated.get(seg.id)
    // The model drops and renumbers ids often enough that gemini.ts has a
    // retry loop for it; whatever is still missing after that simply is not
    // cached.
    if (vi === undefined) continue
    rows.push({ key: keys[i], vi, srcText: seg.srcText, lectureId })
  }
  await putTranslations(rows)
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
    if (msg.type === 'cache-lookup') {
      lookupCached(msg.segments)
        .then((r) => sendResponse(r))
        // A cache failure must never leave the content script waiting. It gets
        // an empty answer and translates everything, which is exactly what it
        // did before the cache existed.
        .catch((e) => {
          console.warn('[udemy-dubbing] cache-lookup:', e)
          sendResponse({ translations: [] } satisfies CacheLookupResponse)
        })
      return true
    }

    if (msg.type === 'translate') {
      const respond = (r: TranslateResponse) => sendResponse(r)
      chrome.storage.local
        .get('apiKey')
        .then(async ({ apiKey }) => {
          if (typeof apiKey !== 'string' || apiKey === '') {
            // No key to retry with: continuing to the next batch would just
            // repeat this failure for the rest of the lecture.
            respond({ error: 'Chưa có API key. Mở trang cài đặt để nhập.', fatal: true })
            return
          }
          try {
            const map = await translateBatch(msg.batch, apiKey)
            // Written before the reply, deliberately: MV3 may terminate the
            // worker as soon as sendResponse returns, and a write started
            // after that is a write that can be lost. Costs a few
            // milliseconds.
            await cacheTranslations(msg.batch, map, msg.lectureId)
            respond({ translations: Array.from(map.entries()) })
          } catch (e) {
            // A rejected key, or any other permanent error (e.g. a retired
            // model id), will keep failing every subsequent batch too;
            // everything else (rate limits, 5xx) is transient and worth
            // retrying on the next batch.
            if (e instanceof InvalidApiKeyError || e instanceof PermanentApiError) {
              respond({ error: e.message, fatal: true })
            } else {
              respond({ error: e instanceof Error ? e.message : String(e) })
            }
          }
        })
        // If reading storage itself fails, the `.then` above never runs, so
        // `sendResponse` would otherwise never be called and the caller's
        // `sendMessage` would hang until the message port closes.
        .catch((e) => respond({ error: e instanceof Error ? e.message : String(e) }))
      return true
    }

    if (msg.type === 'fetch-caption') {
      if (!isCaptionUrlAllowed(msg.url)) {
        sendResponse({ error: 'URL phụ đề không hợp lệ.' })
        return true
      }
      // The page's own cookies are needed; the service worker has them.
      // `redirect: 'error'` matters: with the default `follow`, a 302 from an
      // allowed host would walk this credentialed request straight off the
      // allowlist.
      try {
        // `fetch()` never throws synchronously — the Fetch spec converts a
        // Request constructor error (e.g. from a URL carrying embedded
        // credentials, such as `https://evil.com@www.udemy.com/x.vtt`) into
        // a rejection, which the `.catch` below handles. This wrapper only
        // guarantees the listener callback cannot throw before `return true`.
        // fetch() only rejects on a network-level failure; a 403/404/5xx
        // resolves normally. Without the r.ok check, that response's body
        // (often an HTML error page) would be handed to parseVtt as if it
        // were the caption file, come back as zero cues, and let the
        // content script fall through to the <track> fallback — silently
        // reproducing the "Bài giảng này không có phụ đề." misdiagnosis F1
        // exists to remove, just one layer further down.
        fetch(msg.url, { credentials: 'include', redirect: 'error' })
          .then((r) => (r.ok ? r.text().then((text) => sendResponse({ text })) : sendResponse({ error: `HTTP ${r.status}` })))
          .catch((e) => sendResponse({ error: String(e) }))
      } catch (e) {
        sendResponse({ error: String(e) })
      }
      return true
    }

    if (msg.type === 'tts-health') {
      // ttsHealth never rejects, but the .catch is not dead weight: a
      // listener that returns true and then never calls sendResponse hangs
      // the caller until the port closes.
      ttsHealth()
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }))
      return true
    }

    if (msg.type === 'tts-speak') {
      if (typeof msg.text !== 'string' || msg.text.trim() === '') {
        sendResponse({ error: 'tts-speak requires non-empty text' })
        return true
      }
      synthesize(msg.text)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }))
      return true
    }

    return false
  })
})
