import type { Cue } from './types'

const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

function stripTags(line: string): string {
  // Removes <v Name>, <b>, <00:00:01.000> and friends.
  return line.replace(/<[^>]*>/g, '')
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const timeIndex = lines.findIndex((l) => TIMESTAMP.test(l))
    if (timeIndex === -1) continue

    const match = TIMESTAMP.exec(lines[timeIndex])
    if (!match) continue

    const body = lines
      .slice(timeIndex + 1)
      .map((l) => stripTags(l).trim())
      .filter((l) => l !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (body === '') continue

    cues.push({
      start: toSeconds(match[1], match[2], match[3], match[4]),
      end: toSeconds(match[5], match[6], match[7], match[8]),
      text: body,
    })
  }

  return cues
}
