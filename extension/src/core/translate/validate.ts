import type { Segment } from '../types'

export interface MatchResult {
  matched: Map<number, string>
  /** Ids the model failed to return usefully. These go back in the queue. */
  missing: number[]
}

function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const body = (fenced ? fenced[1] : raw).trim()
  try {
    return JSON.parse(body)
  } catch {
    // Fall back to the outermost array, in case the model added prose.
    const start = body.indexOf('[')
    const end = body.lastIndexOf(']')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(body.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export function matchTranslations(batch: Segment[], raw: string): MatchResult {
  const wanted = new Set(batch.map((s) => s.id))
  const matched = new Map<number, string>()
  const parsed = extractJson(raw)

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const { id, vi } = entry as { id?: unknown; vi?: unknown }
      if (typeof id !== 'number' || !wanted.has(id)) continue
      if (typeof vi !== 'string' || vi.trim() === '') continue
      matched.set(id, vi.trim())
    }
  }

  return { matched, missing: batch.map((s) => s.id).filter((id) => !matched.has(id)) }
}
