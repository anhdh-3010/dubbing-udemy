import type { Cue } from '../core/types'

/**
 * Fallback for when no .vtt request is seen — the page may have served the
 * captions from its own cache. Setting mode to 'hidden' makes the browser load
 * the cues without drawing them over the video.
 */
export function cuesFromTextTracks(video: HTMLVideoElement): Cue[] {
  const cues: Cue[] = []

  for (const track of Array.from(video.textTracks)) {
    if (track.kind !== 'captions' && track.kind !== 'subtitles') continue
    track.mode = 'hidden'
    for (const cue of Array.from(track.cues ?? [])) {
      const text = (cue as VTTCue).text?.replace(/<[^>]*>/g, '').trim()
      if (!text) continue
      cues.push({ start: cue.startTime, end: cue.endTime, text })
    }
    if (cues.length > 0) break
  }

  return cues.sort((a, b) => a.start - b.start)
}
