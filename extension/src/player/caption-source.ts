import type { Cue } from '../core/types'

/**
 * Fallback for when no .vtt request is seen — the page may have served the
 * captions from its own cache. Setting mode to 'hidden' makes the browser load
 * the cues without drawing them over the video.
 */
export function cuesFromTextTracks(video: HTMLVideoElement): Cue[] {
  const candidates: { track: TextTrack; cues: Cue[] }[] = []

  for (const track of Array.from(video.textTracks)) {
    if (track.kind !== 'captions' && track.kind !== 'subtitles') continue
    // Enable every candidate track, not just the first: a cold track (see
    // cuesFromTracksWhenReady) yields no cues on this pass either way, and
    // deciding the winner needs cues from all of them, not just the first.
    track.mode = 'hidden'
    const cues: Cue[] = []
    for (const cue of Array.from(track.cues ?? [])) {
      const text = (cue as VTTCue).text?.replace(/<[^>]*>/g, '').trim()
      if (!text) continue
      cues.push({ start: cue.startTime, end: cue.endTime, text })
    }
    if (cues.length > 0) candidates.push({ track, cues })
  }

  // A multi-language lecture can hand the translator a non-English track —
  // even a Vietnamese one, which would then be "translated" into itself.
  // Prefer English; otherwise fall back to the first track that yielded cues.
  const chosen =
    candidates.find((c) => c.track.language.toLowerCase().startsWith('en')) ?? candidates[0]

  return chosen ? chosen.cues.sort((a, b) => a.start - b.start) : []
}
