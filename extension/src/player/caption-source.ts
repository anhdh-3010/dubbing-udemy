import type { Cue } from '../core/types'

/**
 * True for a track that is plausibly English: tagged with a `language`
 * starting "en", or — since `language` is frequently left unset — labelled
 * as English. Shared by `cuesFromTextTracks`'s own preference and by
 * `cuesFromTextTracksWhenReady`'s "does an English track exist at all" test,
 * so the two agree on what counts.
 */
function looksEnglish(track: TextTrack): boolean {
  return track.language.toLowerCase().startsWith('en') || /^en|english/i.test(track.label)
}

/** True if any captions/subtitles track on `video` looks English, whether or
 *  not it has produced cues yet. A script-added track (hls.js, video.js,
 *  ...) can exist with its language/label already set before it has loaded
 *  any cues, which is exactly the case this exists to catch. */
function hasEnglishTrack(video: HTMLVideoElement): boolean {
  for (const track of Array.from(video.textTracks)) {
    if (track.kind !== 'captions' && track.kind !== 'subtitles') continue
    if (looksEnglish(track)) return true
  }
  return false
}

/**
 * Reads whatever cues the browser's native <track> elements currently
 * expose. Setting mode to 'hidden' makes the browser load the cues without
 * drawing them over the video.
 *
 * When `requireEnglish` is true, only a track that looksEnglish counts, and
 * no cues at all counts as a miss (rather than falling back to a different
 * track) — used while polling in cuesFromTextTracksWhenReady, so a
 * same-language match is never dropped in favour of a track that merely
 * finished loading first.
 */
export function cuesFromTextTracks(video: HTMLVideoElement, requireEnglish = false): Cue[] {
  const candidates: { track: TextTrack; cues: Cue[] }[] = []

  for (const track of Array.from(video.textTracks)) {
    if (track.kind !== 'captions' && track.kind !== 'subtitles') continue
    // Enable every candidate track, not just the first: a cold track (see
    // cuesFromTextTracksWhenReady) yields no cues on this pass either way,
    // and deciding the winner needs cues from all of them, not just the
    // first.
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
  const english = candidates.find((c) => looksEnglish(c.track))
  if (requireEnglish) return english ? english.cues.sort((a, b) => a.start - b.start) : []

  const chosen = english ?? candidates[0]
  return chosen ? chosen.cues.sort((a, b) => a.start - b.start) : []
}

export interface WhenReadyOptions {
  /** Total time to hold out for an English track before accepting anything. */
  deadlineMs?: number
  /** Delay between reads while waiting. */
  intervalMs?: number
  /**
   * Checked on every iteration; a true return ends the wait early with `[]`.
   * The caller stays free of DOM state here — e.g. content.ts uses this to
   * bail out the moment a caption URL shows up, so it can fetch the VTT
   * directly instead of continuing to wait on <track> elements.
   */
  abortWhen?: () => boolean
  /**
   * Decides whether a candidate result is good enough to return. Defaults to
   * "non-empty". A caller that can be handed a *stale* result the tracks
   * already carried over from something else — e.g. content.ts reusing the
   * same <video> element across lectures — passes a stricter predicate (for
   * instance, one that also rejects a cue signature it already knows is
   * stale) so the poll keeps waiting instead of settling for it.
   */
  accept?: (cues: Cue[]) => boolean
}

/**
 * Cold <track> elements fetch and parse in parallel with the first read, so a
 * single synchronous call reliably returns nothing. Polls instead of
 * listening for `load`, because script-created tracks (hls.js, video.js,
 * ...) never fire it.
 *
 * `cuesFromTextTracks` enables every candidate track on its first read, so a
 * multi-language lecture has all of them racing to finish loading in
 * arbitrary order. Requiring English is only correct while an English track
 * actually exists (whether or not it has cues yet) — re-evaluated on every
 * iteration, since a script-added track may not exist in `textTracks` on the
 * first read. When no English track exists at all, the very first candidate
 * with cues is accepted immediately, so a lecture with a single untagged (or
 * non-English) track is never held up waiting for an English track that will
 * never appear. Once the deadline passes regardless, it falls back to
 * whatever `cuesFromTextTracks` finds without the English requirement.
 */
export async function cuesFromTextTracksWhenReady(
  video: HTMLVideoElement,
  opts: WhenReadyOptions = {},
): Promise<Cue[]> {
  const {
    deadlineMs = 3000,
    intervalMs = 150,
    abortWhen,
    accept = (cues: Cue[]) => cues.length > 0,
  } = opts
  const deadline = Date.now() + deadlineMs

  for (;;) {
    const cues = cuesFromTextTracks(video, hasEnglishTrack(video))
    if (accept(cues)) return cues
    if (abortWhen?.()) return []
    if (Date.now() >= deadline) {
      const fallback = cuesFromTextTracks(video)
      return accept(fallback) ? fallback : []
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
