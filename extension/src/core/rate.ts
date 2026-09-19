export const MIN_TTS_RATE = 1.0
export const MAX_TTS_RATE = 1.4
/** Floor on video slowdown, relative to the speed the viewer chose. */
export const VIDEO_SLOWDOWN_FLOOR = 0.85

export interface StretchInput {
  segmentStart: number
  segmentEnd: number
  /** Silence before the next segment starts, in video-time seconds. */
  gapAfter: number
  /** Seconds the utterance takes at rate 1.0. */
  duration: number
  /** The playback speed the viewer chose. Not 1.0 by default. */
  baseline: number
}

export interface StretchPlan {
  ttsRate: number
  videoRate: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function computeStretch(input: StretchInput): StretchPlan {
  const { segmentStart, segmentEnd, gapAfter, duration, baseline } = input

  // W is measured in video time; haveWall converts it to real seconds.
  const W = Math.max(0, segmentEnd - segmentStart) + Math.max(0, gapAfter)
  const haveWall = W / baseline

  if (haveWall <= 0 || duration <= 0) {
    return { ttsRate: MAX_TTS_RATE, videoRate: baseline }
  }

  const ttsRate = clamp(duration / haveWall, MIN_TTS_RATE, MAX_TTS_RATE)
  const needWall = duration / ttsRate

  const videoRate =
    needWall > haveWall
      ? Math.max(VIDEO_SLOWDOWN_FLOOR * baseline, W / needWall)
      : baseline

  return { ttsRate, videoRate }
}
