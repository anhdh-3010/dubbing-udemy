import { buildPrompt } from '../core/translate/prompt'
import { matchTranslations } from '../core/translate/validate'
import type { Segment } from '../core/types'

// Pinned deliberately, not the `gemini-flash-lite-latest` alias: this pipeline
// parses structured JSON keyed by segment id, and a model that silently
// changes under us could change output formatting with no warning. Note also
// that `GET /v1beta/models` listing a model does NOT mean it is callable —
// `gemini-2.5-flash-lite` stayed in that list after Google 404'd it for this
// key, with the response telling callers to move to `gemini-3.5-flash-lite`.
// When this pinned model eventually ages out too, FIX 2 (below) makes the
// resulting error self-explanatory instead of a bare status code.
const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'

const MAX_ATTEMPTS = 3

export class InvalidApiKeyError extends Error {
  constructor() {
    super('API key bị từ chối. Mở trang cài đặt để nhập lại.')
    this.name = 'InvalidApiKeyError'
  }
}

/** A non-ok response that is not a bad key and will never succeed on retry
 *  (e.g. a 404 for a retired model id, or a malformed-request 400). */
export class PermanentApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentApiError'
  }
}

/** Builds the thrown-error message for a non-ok response, folding in
 *  Google's own `error.message` when the body carries one. The body may not
 *  be JSON (an HTML error page, plain text, or empty) — reading and parsing
 *  it must never throw, so any failure here just falls back to the bare
 *  status. `res.text()` is called exactly once, since a `Response` body can
 *  only be consumed once. */
async function describeFailure(res: Response): Promise<string> {
  let googleMessage: string | undefined
  try {
    const text = await res.text()
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    googleMessage = parsed.error?.message
  } catch {
    // Not JSON, or the body couldn't be read at all — no extra detail.
  }
  return googleMessage
    ? `translation request failed: ${res.status} ${googleMessage}`
    : `translation request failed: ${res.status}`
}

async function callOnce(prompt: string, apiKey: string, f: typeof fetch): Promise<string> {
  const res = await f(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  })

  if (res.status === 401 || res.status === 403) throw new InvalidApiKeyError()
  if (!res.ok) {
    const message = await describeFailure(res)
    // 429 and any 5xx are transient — the retry loop in translateBatch
    // handles those. Any other 4xx (e.g. a retired model id 404ing) cannot
    // succeed on retry, so it must propagate as permanent instead.
    if (res.status === 429 || res.status >= 500) throw new Error(message)
    throw new PermanentApiError(message)
  }

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
      // A rejected key is final, and so is any other permanent error (e.g. a
      // retired model id 404ing) — neither will succeed on retry. A rate
      // limit or a 5xx is exactly what the retry loop is for, and whatever
      // earlier attempts already translated stays in `result`.
      if (e instanceof InvalidApiKeyError) throw e
      if (e instanceof PermanentApiError) throw e
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
