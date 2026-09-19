import { translateBatch } from '../background/gemini'
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

type Request = TranslateRequest | FetchCaptionRequest

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
    if (msg.type === 'translate') {
      chrome.storage.local.get('apiKey').then(async ({ apiKey }) => {
        if (typeof apiKey !== 'string' || apiKey === '') {
          sendResponse({ error: 'Chưa có API key. Mở trang cài đặt để nhập.' })
          return
        }
        try {
          const map = await translateBatch(msg.batch, apiKey)
          sendResponse({ translations: Array.from(map.entries()) })
        } catch (e) {
          sendResponse({ error: e instanceof Error ? e.message : String(e) })
        }
      })
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
        // `fetch()` (via the `Request` constructor) can itself throw
        // synchronously — e.g. `https://evil.com@www.udemy.com/x.vtt` parses
        // to an allowed host and pathname and so passes the predicate above,
        // but the Fetch spec requires a TypeError for a URL carrying
        // embedded credentials. Catch that here so it can never escape the
        // listener callback and leave the caller's `sendMessage` hanging.
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
