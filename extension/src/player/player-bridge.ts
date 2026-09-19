const LECTURE_URL = /\/learn\/lecture\/(\d+)/

export function lectureIdFromUrl(url: string): string | null {
  return LECTURE_URL.exec(url)?.[1] ?? null
}

export interface PlayerBridgeEvents {
  attached: (video: HTMLVideoElement) => void
  detached: () => void
  lectureChanged: (lectureId: string) => void
  seeked: () => void
  ratechange: (rate: number) => void
  pause: () => void
}

type Handlers = { [K in keyof PlayerBridgeEvents]?: PlayerBridgeEvents[K][] }

export interface PlayerBridge {
  readonly video: HTMLVideoElement | null
  on<K extends keyof PlayerBridgeEvents>(event: K, fn: PlayerBridgeEvents[K]): void
  start(): void
  stop(): void
}

/**
 * Udemy is a single page app: navigating to the next lecture swaps the video
 * element without a page load, so the bridge watches the DOM and the URL
 * rather than relying on load events.
 */
export function createPlayerBridge(doc: Document): PlayerBridge {
  const handlers: Handlers = {}
  let video: HTMLVideoElement | null = null
  let lectureId: string | null = null
  let observer: MutationObserver | null = null

  const emit = <K extends keyof PlayerBridgeEvents>(
    event: K,
    ...args: Parameters<PlayerBridgeEvents[K]>
  ) => {
    for (const fn of handlers[event] ?? []) {
      try {
        ;(fn as (...a: unknown[]) => void)(...args)
      } catch (e) {
        // A handler that throws must not unwind out of the bridge: start()
        // calls scan() synchronously, so an uncaught throw here would leave
        // the MutationObserver connected but the caller's start() aborted.
        console.error('[player-bridge] handler threw', e)
      }
    }
  }

  const onSeeked = () => emit('seeked')
  const onRateChange = () => {
    if (video) emit('ratechange', video.playbackRate)
  }
  const onPause = () => emit('pause')

  const detach = () => {
    if (!video) return
    video.removeEventListener('seeked', onSeeked)
    video.removeEventListener('ratechange', onRateChange)
    video.removeEventListener('pause', onPause)
    video = null
    emit('detached')
  }

  const scan = () => {
    const url = doc.defaultView?.location.href ?? ''
    const id = lectureIdFromUrl(url)
    if (id !== null && id !== lectureId) {
      lectureId = id
      emit('lectureChanged', id)
    }

    const found = doc.querySelector('video')
    if (found === video) return
    detach()
    if (found === null) return

    video = found
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('pause', onPause)
    emit('attached', video)
  }

  return {
    get video() {
      return video
    },
    on(event, fn) {
      ;(handlers[event] ??= [] as never).push(fn as never)
    },
    start() {
      observer?.disconnect()
      observer = new MutationObserver(scan)
      observer.observe(doc.documentElement, { childList: true, subtree: true })
      scan()
    },
    stop() {
      observer?.disconnect()
      observer = null
      detach()
    },
  }
}
