import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSpeechProvider } from './web-speech'

class FakeSpeechSynthesisUtterance {
  text = ''
  lang = ''
  rate = 1
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

function installFakeSpeech() {
  const spoken: FakeSpeechSynthesisUtterance[] = []
  const synth = {
    speak: vi.fn((u: FakeSpeechSynthesisUtterance) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: () => [{ lang: 'vi-VN', name: 'Linh', default: true }],
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
  return { synth, spoken }
}

describe('WebSpeechProvider', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('báo là không biết trước thời lượng', () => {
    installFakeSpeech()
    expect(new WebSpeechProvider().knowsDurationAhead).toBe(false)
  })

  it('khả dụng khi có giọng vi-VN', async () => {
    installFakeSpeech()
    expect(await new WebSpeechProvider().isAvailable()).toBe(true)
  })

  it('ước lượng thời lượng theo độ dài văn bản', async () => {
    installFakeSpeech()
    const p = new WebSpeechProvider()
    const short = await p.prepare('ngắn', new AbortController().signal)
    const long = await p.prepare('x'.repeat(200), new AbortController().signal)
    expect(long.duration).toBeGreaterThan(short.duration)
  })

  it('truyền tốc độ đọc xuống SpeechSynthesisUtterance', async () => {
    const { spoken } = installFakeSpeech()
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    void u.play(1.25)
    expect(spoken[0].rate).toBeCloseTo(1.25)
  })

  it('play resolve khi onend được gọi', async () => {
    const { spoken } = installFakeSpeech()
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    const done = u.play(1)
    spoken[0].onend?.()
    await expect(done).resolves.toBeUndefined()
  })

  it('cancel gọi speechSynthesis.cancel', async () => {
    const { synth } = installFakeSpeech()
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    void u.play(1)
    u.cancel()
    expect(synth.cancel).toHaveBeenCalled()
  })

  it('hiệu chỉnh ước lượng sau khi đọc xong', async () => {
    vi.useFakeTimers()
    try {
      const { spoken } = installFakeSpeech()
      const p = new WebSpeechProvider()
      const before = p.charsPerSecond
      const u = await p.prepare('x'.repeat(100), new AbortController().signal)
      const done = u.play(1)
      vi.advanceTimersByTime(5000)
      spoken[0].onend?.()
      await done
      expect(p.charsPerSecond).not.toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })
})
