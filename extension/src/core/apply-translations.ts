import type { Segment } from './types'

/**
 * Writes translated text onto the segments it belongs to, matched by id, and
 * returns how many landed.
 *
 * Both paths that produce translations end here: the cache pre-pass and the
 * LLM's own reply. They differ only in where the pairs came from, so they
 * must not differ in how the pairs are applied — an id that matches nothing
 * is skipped in both, and `status` moves to 'ready' in both.
 */
export function applyTranslations(
  segments: Segment[],
  pairs: Iterable<readonly [number, string]>,
): number {
  const byId = new Map(segments.map((s) => [s.id, s]))
  let applied = 0
  for (const [id, vi] of pairs) {
    const seg = byId.get(id)
    if (seg === undefined) continue
    seg.viText = vi
    seg.status = 'ready'
    applied++
  }
  return applied
}
