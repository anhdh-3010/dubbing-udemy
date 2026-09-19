import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSpeechProvider } from './web-speech'

class FakeSpeechSynthesisUtterance {
  text = ''
  lang = ''
  rate = 1
  voice: unknown = null
  onstart: (() => void) | null = null
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

  it('không học từ câu bị huỷ giữa chừng', async () => {
    vi.useFakeTimers()
    try {
      const { spoken } = installFakeSpeech()
      const p = new WebSpeechProvider()
      const before = p.charsPerSecond
      const u = await p.prepare('x'.repeat(100), new AbortController().signal)
      const done = u.play(1)
      spoken[0].onstart?.()
      vi.advanceTimersByTime(200) // mới đọc được 0,2 giây thì bị tua
      u.cancel()
      spoken[0].onend?.()
      await expect(done).rejects.toThrow()
      expect(p.charsPerSecond).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('huỷ thì play reject bằng AbortError, kể cả khi engine báo end', async () => {
    const { spoken } = installFakeSpeech()
    const p = new WebSpeechProvider()
    const u = await p.prepare('xin chào', new AbortController().signal)
    const done = u.play(1)
    u.cancel()
    spoken[0].onend?.()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('huỷ rồi engine báo error thì vẫn là AbortError', async () => {
    const { spoken } = installFakeSpeech()
    const p = new WebSpeechProvider()
    const u = await p.prepare('xin chào', new AbortController().signal)
    const done = u.play(1)
    u.cancel()
    spoken[0].onerror?.()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('engine lỗi mà không hề huỷ thì là lỗi thật', async () => {
    const { spoken } = installFakeSpeech()
    const p = new WebSpeechProvider()
    const u = await p.prepare('xin chào', new AbortController().signal)
    const done = u.play(1)
    spoken[0].onerror?.()
    await expect(done).rejects.toThrow(/speech synthesis failed/)
  })

  it('chọn đúng giọng tiếng Việt giữa nhiều giọng', async () => {
    const spoken: FakeSpeechSynthesisUtterance[] = []
    const viVoice = { lang: 'vi-VN', name: 'Linh', default: false }
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn((u: FakeSpeechSynthesisUtterance) => spoken.push(u)),
      cancel: vi.fn(),
      getVoices: () => [{ lang: 'en-US', name: 'Alex', default: true }, viVoice],
    })
    vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    void u.play(1)
    expect(spoken[0].voice).toBe(viVoice)
  })

  it('chỉ tính giờ từ lúc engine thật sự bắt đầu nói', async () => {
    vi.useFakeTimers()
    try {
      const { spoken } = installFakeSpeech()
      const p = new WebSpeechProvider()
      const u = await p.prepare('x'.repeat(100), new AbortController().signal)
      const done = u.play(1)
      vi.advanceTimersByTime(3000) // engine xếp hàng 3 giây
      spoken[0].onstart?.()
      vi.advanceTimersByTime(5000) // đọc thật 5 giây
      spoken[0].onend?.()
      await done
      // 100 ký tự / 5 giây = 20 ch/s, trộn với 15 thành 16.
      // Nếu tính cả 3 giây xếp hàng thì chỉ 12,5 ch/s và kết quả là 14,5.
      expect(p.charsPerSecond).toBeCloseTo(16)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prepare không vỡ khi môi trường không có speechSynthesis', async () => {
    vi.unstubAllGlobals()
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    expect(u.duration).toBeGreaterThan(0)
  })

  it('chờ voiceschanged nếu getVoices() rỗng lúc đầu, rồi nhận ra giọng tiếng Việt', async () => {
    let voices: { lang: string; name: string; default: boolean }[] = []
    const listeners: Record<string, (() => void)[]> = {}
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => voices,
      addEventListener: (type: string, cb: () => void) => {
        ;(listeners[type] ??= []).push(cb)
      },
      removeEventListener: (type: string, cb: () => void) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb)
      },
    })

    const promise = new WebSpeechProvider().isAvailable()
    // The voice list "loads" only after isAvailable() has already started
    // waiting — this is exactly the Chrome-after-page-load gap.
    voices = [{ lang: 'vi-VN', name: 'Linh', default: true }]
    listeners['voiceschanged']?.forEach((cb) => cb())

    expect(await promise).toBe(true)
  })

  it('hết thời gian chờ mà voiceschanged không tới thì vẫn kết luận theo getVoices() hiện có', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('speechSynthesis', {
        speak: vi.fn(),
        cancel: vi.fn(),
        getVoices: () => [] as { lang: string; name: string; default: boolean }[],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })

      const promise = new WebSpeechProvider().isAvailable()
      await vi.advanceTimersByTimeAsync(2000)

      expect(await promise).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
