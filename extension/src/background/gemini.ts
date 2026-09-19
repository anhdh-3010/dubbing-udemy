import { buildPrompt } from '../core/translate/prompt'
import { matchTranslations } from '../core/translate/validate'
import type { Segment } from '../core/types'

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'

const MAX_ATTEMPTS = 3

export class InvalidApiKeyError extends Error {
  constructor() {
    super('API key bị từ chối. Mở trang cài đặt để nhập lại.')
    this.name = 'InvalidApiKeyError'
  }
}

async function callOnce(prompt: string, apiKey: string, f: typeof fetch): Promise<string> {
  const res = await f(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  })

  if (res.status === 401 || res.status === 403) throw new InvalidApiKeyError()
  if (!res.ok) throw new Error(`translation request failed: ${res.status}`)

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

/**
 * Translates one batch, re-asking only for the entries the model failed to
 * return. Batched translation drops or renumbers ids often enough that this
 * retry loop is load-bearing, not defensive padding.
 */
export async function translateBatch(
  batch: Segment[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  let remaining = batch
  let lastError: unknown = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS && remaining.length > 0; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt))

    let raw: string
    try {
      raw = await callOnce(buildPrompt(remaining), apiKey, fetchImpl)
      lastError = null
    } catch (e) {
      // A rejected key is final. A rate limit or a 5xx is exactly what the
      // retry loop is for, and whatever earlier attempts already translated
      // stays in `result`.
      if (e instanceof InvalidApiKeyError) throw e
      lastError = e
      continue
    }

    const { matched, missing } = matchTranslations(remaining, raw)
    for (const [id, vi] of matched) result.set(id, vi)

    const missingSet = new Set(missing)
    remaining = remaining.filter((s) => missingSet.has(s.id))
  }

  // Partial success resolves — the caller keeps the segments we did get.
  // A total failure still surfaces its cause rather than looking like an
  // empty translation.
  if (result.size === 0 && lastError !== null) throw lastError

  return result
}
