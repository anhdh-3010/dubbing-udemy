import type { Cue, Segment } from './types'

export interface MergeOptions {
  /** A silence longer than this ends the sentence, in seconds. */
  gapThreshold?: number
  /** Hard ceiling on one segment, in seconds. */
  maxDuration?: number
}

const DEFAULTS: Required<MergeOptions> = { gapThreshold: 0.8, maxDuration: 12 }

// A trailing period after one of these is an abbreviation, not a sentence end.
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|fig|no|approx)\.$/i

function endsSentence(text: string): boolean {
  const trimmed = text.trim()
  if (!/[.!?]["')\]]?$/.test(trimmed)) return false
  return !ABBREVIATIONS.test(trimmed)
}

export function mergeCues(cues: Cue[], opts: MergeOptions = {}): Segment[] {
  const { gapThreshold, maxDuration } = { ...DEFAULTS, ...opts }
  const segments: Segment[] = []

  let parts: string[] = []
  let start = 0
  let end = 0

  const flush = () => {
    if (parts.length === 0) return
    segments.push({
      id: segments.length,
      start,
      end,
      srcText: parts.join(' ').replace(/\s+/g, ' ').trim(),
      status: 'pending',
    })
    parts = []
  }

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]
    if (parts.length === 0) start = c.start
    parts.push(c.text)
    end = c.end

    const next = cues[i + 1]
    const gapTooBig = next !== undefined && next.start - c.end > gapThreshold
    const tooLong = next !== undefined && next.end - start > maxDuration

    if (endsSentence(c.text) || gapTooBig || tooLong || next === undefined) flush()
  }

  return segments
}
