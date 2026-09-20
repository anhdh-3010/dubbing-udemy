import { describe, expect, it, vi } from 'vitest'
import type { AudioPlayer } from './audio-player'
import { VieNeuProvider } from './vieneu'

class FakePlayer implements AudioPlayer {
  static last: FakePlayer | null = null
  rateUsed: number | null = null
  cancelled = false
  private settle: (() => void) | null = null

  constructor(readonly wav: string) {
    FakePlayer.last = this
  }

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
  }
}

const OK_RESPONSE = { audio: 'UklGRg==', duration: 3.25 }

function setup(response: unknown = OK_RESPONSE) {
  FakePlayer.last = null
  const send = vi.fn(async () => response)
  const provider = new VieNeuProvider({
    send,
    createPlayer: (wav) => new FakePlayer(wav),
  })
  return { send, provider }
}

describe('VieNeuProvider.isAvailable', () => {
  it('true khi service worker báo server đang sống', async () => {
    const { send, provider } = setup({ ok: true })
    expect(await provider.isAvailable()).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'tts-health' })
  })

  it('false khi server không trả lời', async () => {
    const { provider } = setup({ ok: false })
    expect(await provider.isAvailable()).toBe(false)
  })

  it('false khi service worker bị huỷ giữa chừng', async () => {
    // sendMessage rejects — rather than resolving with an error payload —
    // when the worker is recycled or the port closes.
    const send = vi.fn(async () => {
      throw new Error('message port closed')
    })
    const provider = new VieNeuProvider({ send, createPlayer: (w) => new FakePlayer(w) })
    expect(await provider.isAvailable()).toBe(false)
  })
})

describe('VieNeuProvider.prepare', () => {
  it('gửi văn bản đi và lấy thời lượng chính xác từ server', async () => {
    const { send, provider } = setup()
    const u = await provider.prepare('xin chào', new AbortController().signal)

    expect(send).toHaveBeenCalledWith({ type: 'tts-speak', text: 'xin chào' })
    expect(u.duration).toBe(3.25)
    expect(FakePlayer.last?.wav).toBe('UklGRg==')
  })

  it('knowsDurationAhead là true — thời lượng do server báo, không phải ước lượng', () => {
    const { provider } = setup()
    expect(provider.knowsDurationAhead).toBe(true)
  })

  it('ném lỗi của server ra ngoài', async () => {
    const { provider } = setup({ error: 'TTS request failed: 500' })
    await expect(provider.prepare('x', new AbortController().signal)).rejects.toThrow('500')
  })

  it('ném lỗi khi phản hồi thiếu trường', async () => {
    const { provider } = setup({ audio: 'UklGRg==' })
    await expect(provider.prepare('x', new AbortController().signal)).rejects.toThrow('malformed')
  })

  it('không gọi service worker khi signal đã bị huỷ từ trước', async () => {
    const { send, provider } = setup()
    const controller = new AbortController()
    controller.abort()

    await expect(provider.prepare('x', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('huỷ trình phát khi signal tắt trong lúc đang chờ server', async () => {
    const controller = new AbortController()
    const send = vi.fn(async () => {
      controller.abort()
      return OK_RESPONSE
    })
    const provider = new VieNeuProvider({ send, createPlayer: (w) => new FakePlayer(w) })

    await expect(provider.prepare('x', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(FakePlayer.last?.cancelled).toBe(true)
  })
})

describe('VieNeuProvider utterance', () => {
  it('chuyển tốc độ xuống trình phát và resolve khi phát xong', async () => {
    const { provider } = setup()
    const u = await provider.prepare('xin chào', new AbortController().signal)

    const done = u.play(1.25)
    expect(FakePlayer.last?.rateUsed).toBe(1.25)

    FakePlayer.last?.finish()
    await expect(done).resolves.toBeUndefined()
  })

  it('cancel huỷ trình phát và làm play sau đó reject', async () => {
    const { provider } = setup()
    const u = await provider.prepare('xin chào', new AbortController().signal)

    u.cancel()
    expect(FakePlayer.last?.cancelled).toBe(true)
    await expect(u.play(1)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('VieNeuProvider.warmUp', () => {
  it('tổng hợp một câu rồi vứt đi', async () => {
    const { send, provider } = setup()
    await provider.warmUp()

    expect(send).toHaveBeenCalledWith({ type: 'tts-speak', text: 'Xin chào.' })
    expect(FakePlayer.last?.cancelled).toBe(true)
  })

  it('nuốt lỗi — làm nóng hỏng không được làm hỏng việc gắn vào bài giảng', async () => {
    const { provider } = setup({ error: 'TTS request failed: 500' })
    await expect(provider.warmUp()).resolves.toBeUndefined()
  })
})
