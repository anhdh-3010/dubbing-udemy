export interface Cue {
  /** Seconds from the start of the lecture. */
  start: number
  end: number
  text: string
}

export type SegmentStatus = 'pending' | 'translating' | 'ready' | 'failed'

export interface Segment {
  id: number
  start: number
  end: number
  /** Original English, as it came from the caption file. */
  srcText: string
  /** Vietnamese. Used for both the subtitle overlay and the spoken audio. */
  viText?: string
  status: SegmentStatus
}

/** A piece of speech that has been prepared but not yet played. */
export interface Utterance {
  /** Seconds the utterance takes at rate 1.0. Exact or estimated — see
   *  TTSProvider.knowsDurationAhead. */
  readonly duration: number
  /** Resolves when speech finishes. Rejects with AbortError if cancelled. */
  play(rate: number): Promise<void>
  cancel(): void
}

export interface TTSProvider {
  readonly name: string
  /** False for engines that can only estimate duration, such as Web Speech. */
  readonly knowsDurationAhead: boolean
  isAvailable(): Promise<boolean>
  prepare(text: string, signal: AbortSignal): Promise<Utterance>
}

/** The slice of HTMLVideoElement the scheduler touches, so tests can fake it. */
export interface VideoLike {
  currentTime: number
  playbackRate: number
  volume: number
  paused: boolean
}

export function isReady(segment: Segment): segment is Segment & { viText: string } {
  return segment.status === 'ready' && typeof segment.viText === 'string'
}
