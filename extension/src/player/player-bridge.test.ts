import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayerBridge, lectureIdFromUrl } from './player-bridge'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('lectureIdFromUrl', () => {
  it('lấy được id bài giảng', () => {
    expect(lectureIdFromUrl('https://www.udemy.com/course/react-basics/learn/lecture/12345678')).toBe('12345678')
  })

  it('bỏ qua query string', () => {
    expect(lectureIdFromUrl('https://www.udemy.com/course/x/learn/lecture/999?start=0')).toBe('999')
  })

  it('trả null cho URL không phải trang bài giảng', () => {
    expect(lectureIdFromUrl('https://www.udemy.com/')).toBeNull()
  })
})

describe('createPlayerBridge', () => {
  it('báo attached khi video xuất hiện', async () => {
    const onAttached = vi.fn()
    const bridge = createPlayerBridge(document)
    bridge.on('attached', onAttached)
    bridge.start()

    const video = document.createElement('video')
    document.body.appendChild(video)

    await vi.waitFor(() => expect(onAttached).toHaveBeenCalledWith(video))
    bridge.stop()
  })

  it('chuyển tiếp sự kiện seeked', async () => {
    const onSeek = vi.fn()
    const video = document.createElement('video')
    document.body.appendChild(video)

    const bridge = createPlayerBridge(document)
    bridge.on('seeked', onSeek)
    bridge.start()
    await vi.waitFor(() => expect(bridge.video).toBe(video))

    video.dispatchEvent(new Event('seeked'))
    expect(onSeek).toHaveBeenCalled()
    bridge.stop()
  })

  it('chuyển tiếp ratechange kèm tốc độ mới', async () => {
    const onRate = vi.fn()
    const video = document.createElement('video')
    document.body.appendChild(video)

    const bridge = createPlayerBridge(document)
    bridge.on('ratechange', onRate)
    bridge.start()
    await vi.waitFor(() => expect(bridge.video).toBe(video))

    video.playbackRate = 1.5
    video.dispatchEvent(new Event('ratechange'))
    expect(onRate).toHaveBeenCalledWith(1.5)
    bridge.stop()
  })
})
