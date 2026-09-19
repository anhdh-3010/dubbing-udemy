import { InvalidApiKeyError, translateBatch } from '../background/gemini'
import { isCaptionUrlAllowed } from '../player/caption-hook'
import type { Segment } from '../core/types'

export interface TranslateRequest {
  type: 'translate'
  batch: Segment[]
}

export interface FetchCaptionRequest {
  type: 'fetch-caption'
  url: string
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

type Request = TranslateRequest | FetchCaptionRequest

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
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
            respond({ translations: Array.from(map.entries()) })
          } catch (e) {
            // A rejected key will keep failing every subsequent batch too;
            // everything else (rate limits, 5xx) is transient and worth
            // retrying on the next batch.
            if (e instanceof InvalidApiKeyError) {
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
        fetch(msg.url, { credentials: 'include', redirect: 'error' })
          .then((r) => r.text())
          .then((text) => sendResponse({ text }))
          .catch((e) => sendResponse({ error: String(e) }))
      } catch (e) {
        sendResponse({ error: String(e) })
      }
      return true
    }

    return false
  })
})
