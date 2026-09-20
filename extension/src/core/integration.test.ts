import { describe, expect, it, vi } from 'vitest'
import type { AudioPlayer } from '../providers/audio-player'
import { VieNeuProvider } from '../providers/vieneu'
import { FallbackProvider, type ProviderStatus } from './fallback'
import { Scheduler } from './scheduler'
import { FakeVideo } from './testing/fakes'
import type { Segment, TTSProvider, Utterance } from './types'

/**
 * Finding 3 of the M2 whole-branch review: content.ts:77-87 composes
 * `VieNeuProvider` + `WebSpeechProvider` into a `FallbackProvider` and
 * drives it through a `Scheduler` — the point of the whole milestone — and
 * that composition was covered by no unit test and no e2e test. Deleting
 * content.ts:77-87 and reverting to `new WebSpeechProvider()` left all 209
 * unit tests and all 3 e2e tests green.
 *
 * This file closes that gap without a browser: a real `VieNeuProvider`
 * (its `send`/`createPlayer` are already injectable for exactly this
 * reason — see vieneu.test.ts), a real `FallbackProvider`, and a real
 * `Scheduler` driven with `FakeVideo`, wired together the same way
 * content.ts wires the real ones.
 */

/** Stands in for createAudioPlayer(): resolves play() only when the test
 *  calls finish(), same shape as vieneu.test.ts's own FakePlayer. */
class FakePlayer implements AudioPlayer {
  rateUsed: number | null = null
  cancelled = false
  private settle: (() => void) | null = null

  play(rate: number): Promise<void> {
    this.rateUsed = rate
    return new Promise<void>((resolve) => {
      this.settle = resolve
    })
  }

  finish(): void {
    this.settle?.()
    this.settle = null
  }

  cancel(): void {
    this.cancelled = true
    this.settle?.()
    this.settle = null
  }
}

/** A minimal always-available backup — stands in for WebSpeechProvider so
 *  this test does not depend on speechSynthesis or its own watchdog. */
class StubBackup implements TTSProvider {
  readonly name = 'stub-backup'
  readonly knowsDurationAhead = false
  calls = 0
  readonly players: FakePlayer[] = []

  async isAvailable(): Promise<boolean> {
    return true
  }

  async prepare(): Promise<Utterance> {
    this.calls++
    const player = new FakePlayer()
    this.players.push(player)
    return { duration: 2, play: (rate) => player.play(rate), cancel: () => player.cancel() }
  }
}

const segs = (): Segment[] => [
  { id: 0, start: 1, end: 5, srcText: 'a', viText: 'câu một', status: 'ready' },
  { id: 1, start: 6, end: 10, srcText: 'b', viText: 'câu hai', status: 'ready' },
]

describe('Composition: VieNeuProvider + FallbackProvider + Scheduler (spec 8.4)', () => {
  it('dùng primary khi server sống; khi server hỏng giữa bài, tiếp tục đọc qua backup và chỉ báo trạng thái đúng một lần', async () => {
    let healthy = true
    const primaryPlayers: FakePlayer[] = []
    const vieneu = new VieNeuProvider({
      send: async () => {
        if (!healthy) throw new Error('server unreachable')
        return { audio: 'UklGRg==', duration: 3 }
      },
      createPlayer: () => {
        const p = new FakePlayer()
        primaryPlayers.push(p)
        return p
      },
    })
    const backup = new StubBackup()
    const changes: [ProviderStatus, string][] = []
    const provider = new FallbackProvider(vieneu, backup, {
      onStatusChange: (status, reason) => changes.push([status, reason]),
    })

    const video = new FakeVideo()
    const scheduler = new Scheduler({ video, provider })
    scheduler.setSegments(segs())

    // Segment 0: the server is healthy, so the primary speaks it and the
    // backup is never touched.
    video.currentTime = 1.0
    await scheduler.tick()

    expect(primaryPlayers).toHaveLength(1)
    expect(backup.calls).toBe(0)
    expect(provider.status).toBe('primary')
    expect(changes).toEqual([])

    primaryPlayers[0].finish()
    await vi.waitFor(() => expect(video.volume).toBeCloseTo(1))

    // The server drops before segment 1's slot arrives — a crash, or the
    // `launchctl bootout` step in the milestone's own manual verification
    // (docs/superpowers/plans/2026-09-20-m2-real-voice.md, Task 10 Step 3).
    healthy = false

    video.currentTime = 6.0
    await scheduler.tick()

    // Speech continues: the backup speaks the sentence the primary could
    // not, rather than the dub going silent (spec 10).
    expect(backup.calls).toBe(1)
    expect(provider.status).toBe('fallback')
    // Exactly once — not once per sentence, and not silently. content.ts's
    // onStatusChange turns this straight into an on-page notice; firing on
    // every sentence would be a spurious repeated toast, and never firing
    // would leave the viewer with no explanation for the switch.
    expect(changes).toHaveLength(1)
    expect(changes[0][0]).toBe('fallback')
  })
})
