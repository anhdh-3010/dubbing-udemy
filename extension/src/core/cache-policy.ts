/**
 * Every decision the cache makes, with nothing that touches IndexedDB.
 *
 * `crypto.subtle` and `TextEncoder` are used here although `src/core/` is the
 * pure layer. Both exist on `globalThis` in Node 20, so neither costs this
 * module its "testable without a browser" property — the same reasoning that
 * admitted `DOMException` in M2 (see that milestone's Ruling 3).
 */

/** Bumped whenever `core/translate/prompt.ts` changes in a way that would
 *  change output: the IT-terminology rules, the length budget, the voice.
 *  Cached translations were produced under the rules in force at the time,
 *  so the version has to be part of the key or old output silently survives
 *  a rule change. */
export const PROMPT_VERSION = 1

/** Spec 9's "hạn mức cấu hình được". This is only the default; the real
 *  value is read from `chrome.storage.local` (M3b adds the UI for it). */
export const DEFAULT_AUDIO_QUOTA_BYTES = 300 * 1024 * 1024

/** Translations are text, so they are bounded by row count rather than by
 *  bytes: 50k rows is roughly 7 MB, and about 125 hours of lectures. */
export const TRANSLATION_MAX_ENTRIES = 50_000

const encoder = new TextEncoder()

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The cache key for one translated sentence.
 *
 * Keyed by the *content* of the source sentence, never by `Segment.id` —
 * that id is an array index out of `mergeCues`, so an id-based key would
 * hand back the wrong sentence's Vietnamese the moment the merge algorithm
 * or the caption file changes. Hashing the text makes that mismatch
 * structurally impossible: a changed merge misses, it does not mis-hit.
 */
export async function translationKey(
  srcText: string,
  targetLang: string,
  model: string,
  promptVersion: number = PROMPT_VERSION,
): Promise<string> {
  return `${targetLang}|${model}|p${promptVersion}|${await sha256Hex(srcText)}`
}

/** The cache key for one synthesised sentence. Hashes the *Vietnamese* —
 *  that is what was sent to the engine. `voice` and `steps` are in the key
 *  from the start, though M3a cannot yet change them, so that when M3b
 *  exposes them the cache misses instead of replaying the old voice. */
export async function audioKey(viText: string, voice: string, steps: number): Promise<string> {
  return `${voice}|s${steps}|${await sha256Hex(viText)}`
}

export interface LruEntry {
  key: string
  /** What deleting this row frees: bytes for audio, 1 for a translation. */
  cost: number
}

/**
 * Which rows to delete to bring `total` back to `limit`, given `lru` ordered
 * least-recently-used first. Stops as soon as the total would be under the
 * limit, so a cache slightly over budget loses one row, not half its
 * contents.
 */
export function planEvictions(
  lru: readonly LruEntry[],
  total: number,
  limit: number,
): { keys: string[]; freed: number } {
  if (total <= limit) return { keys: [], freed: 0 }

  const keys: string[] = []
  let freed = 0
  for (const entry of lru) {
    if (total - freed <= limit) break
    keys.push(entry.key)
    freed += entry.cost
  }
  return { keys, freed }
}
