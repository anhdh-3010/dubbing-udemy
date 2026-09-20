import { describe, expect, it, vi } from 'vitest'
import { FallbackProvider, type ProviderStatus } from './fallback'
import type { TTSProvider, Utterance } from './types'

const utterance = (duration: number): Utterance => ({
  duration,
  play: async () => {},
  cancel: () => {},
})

/** A provider whose availability and failure mode the test controls. */
class ControllableTTS implements TTSProvider {
  available = true
  failWith: Error | null = null
  prepareCalls = 0

  constructor(
    readonly name: string,
    readonly knowsDurationAhead: boolean,
    private readonly duration: number,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async prepare(): Promise<Utterance> {
    this.prepareCalls++
    if (this.failWith) throw this.failWith
    return utterance(this.duration)
  }
}

function setup(cooldownMs = 30_000) {
  const primary = new ControllableTTS('vieneu', true, 1)
  const backup = new ControllableTTS('web-speech', false, 2)
  let clock = 0
  const changes: [ProviderStatus, string][] = []

  const provider = new FallbackProvider(primary, backup, {
    cooldownMs,
    now: () => clock,
    onStatusChange: (status, reason) => changes.push([status, reason]),
  })

  return { primary, backup, provider, changes, tick: (ms: number) => (clock += ms) }
}

const signal = (): AbortSignal => new AbortController().signal

describe('FallbackProvider.isAvailable', () => {
  it('dùng primary khi nó sống, và không hỏi backup', async () => {
    const { primary, backup, provider, changes } = setup()
    backup.isAvailable = vi.fn(async () => true)

    expect(await provider.isAvailable()).toBe(true)
    expect(provider.status).toBe('primary')
    expect(backup.isAvailable).not.toHaveBeenCalled()
    expect(changes).toEqual([])
    expect(primary.prepareCalls).toBe(0)
  })

  it('chuyển sang backup khi primary chết, và nói ra một lần', async () => {
    const { primary, provider, changes } = setup()
    primary.available = false

    expect(await provider.isAvailable()).toBe(true)
    expect(provider.status).toBe('fallback')
    expect(changes).toHaveLength(1)
    expect(changes[0][0]).toBe('fallback')
  })

  it('false khi cả hai đều không dùng được', async () => {
    const { primary, backup, provider } = setup()
    primary.available = false
    backup.available = false

    expect(await provider.isAvailable()).toBe(false)
  })
})

describe('FallbackProvider.prepare', () => {
  it('trả utterance của primary khi mọi thứ bình thường', async () => {
    const { provider, backup } = setup()
    const u = await provider.prepare('xin chào', signal())

    expect(u.duration).toBe(1)
    expect(backup.prepareCalls).toBe(0)
  })

  it('rơi sang backup khi primary ném lỗi, và nói ra', async () => {
    const { primary, provider, changes } = setup()
    primary.failWith = new Error('TTS request failed: 500')

    const u = await provider.prepare('xin chào', signal())

    expect(u.duration).toBe(2)
    expect(provider.status).toBe('fallback')
    expect(changes).toEqual([['fallback', 'TTS request failed: 500']])
  })

  it('không thử lại primary trong thời gian cooldown', async () => {
    const { primary, backup, provider, tick } = setup(30_000)
    primary.failWith = new Error('boom')

    await provider.prepare('một', signal())
    expect(primary.prepareCalls).toBe(1)

    tick(29_000)
    await provider.prepare('hai', signal())
    await provider.prepare('ba', signal())

    // Still 1: every sentence in the cooldown window went straight to the
    // backup. Retrying a dead server once per sentence would add its
    // timeout to every single one.
    expect(primary.prepareCalls).toBe(1)
    expect(backup.prepareCalls).toBe(3)
  })

  it('thử lại primary sau cooldown và quay về nó khi nó sống lại', async () => {
    const { primary, provider, changes, tick } = setup(30_000)
    primary.failWith = new Error('boom')
    await provider.prepare('một', signal())

    tick(30_000)
    primary.failWith = null
    const u = await provider.prepare('hai', signal())

    expect(u.duration).toBe(1)
    expect(provider.status).toBe('primary')
    expect(changes.map((c) => c[0])).toEqual(['fallback', 'primary'])
  })

  it('chỉ nói khi trạng thái thật sự đổi, không nói mỗi câu', async () => {
    const { primary, provider, changes } = setup()
    primary.failWith = new Error('boom')

    await provider.prepare('một', signal())
    await provider.prepare('hai', signal())
    await provider.prepare('ba', signal())

    expect(changes).toHaveLength(1)
  })

  it('ném AbortError ra ngoài mà không kết tội primary', async () => {
    // A seek cancels the sentence being prepared. That is the viewer moving,
    // not the server breaking — treating it as a failure would drop a
    // working engine every time someone scrubs the timeline.
    const { primary, backup, provider, changes } = setup()
    primary.failWith = new DOMException('aborted', 'AbortError')

    await expect(provider.prepare('xin chào', signal())).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(backup.prepareCalls).toBe(0)
    expect(provider.status).toBe('primary')
    expect(changes).toEqual([])
  })
})

describe('FallbackProvider.knowsDurationAhead', () => {
  it('theo engine đang hoạt động', async () => {
    const { primary, provider } = setup()
    expect(provider.knowsDurationAhead).toBe(true)

    primary.failWith = new Error('boom')
    await provider.prepare('xin chào', signal())

    expect(provider.knowsDurationAhead).toBe(false)
  })
})
