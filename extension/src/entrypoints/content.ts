import { planBatches } from '../core/batching'
import { Scheduler } from '../core/scheduler'
import { mergeCues } from '../core/segmenter'
import type { Cue, Segment } from '../core/types'
import { parseVtt } from '../core/vtt'
import { CAPTION_MESSAGE } from '../player/caption-hook'
import { cuesFromTextTracks } from '../player/caption-source'
import { createPlayerBridge } from '../player/player-bridge'
import { WebSpeechProvider } from '../providers/web-speech'

interface TranslateResponse {
  translations?: [number, string][]
  error?: string
  /** Set for errors not worth continuing past (missing/rejected API key). */
  fatal?: boolean
}

export default defineContentScript({
  matches: ['https://www.udemy.com/*'],
  runAt: 'document_idle',

  main() {
    const provider = new WebSpeechProvider()
    const bridge = createPlayerBridge(document)

    let scheduler: Scheduler | null = null
    let segments: Segment[] = []
    let rafId = 0
    let captionUrl: string | null = null

    let noticeEl: HTMLDivElement | null = null
    let noticeTimer = 0

    // Minimal on-page toast: every error path in M1 used to end at
    // console.warn, which no user watching the video would ever see.
    const showNotice = (message: string): void => {
      if (noticeEl === null) {
        noticeEl = document.createElement('div')
        noticeEl.style.cssText =
          'position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:320px;' +
          'padding:10px 14px;border-radius:6px;background:#222;color:#fff;font:13px/1.4 sans-serif;'
        document.body.appendChild(noticeEl)
      }
      noticeEl.textContent = message
      noticeEl.style.display = 'block'
      clearTimeout(noticeTimer)
      // window.setTimeout, not the bare global: "node" is in tsconfig's
      // `types`, so the ambient setTimeout resolves to Node's overload
      // (NodeJS.Timeout) rather than the DOM's number.
      noticeTimer = window.setTimeout(() => noticeEl && (noticeEl.style.display = 'none'), 6000)
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = event.data as { type?: string; url?: string }
      if (data?.type === CAPTION_MESSAGE && typeof data.url === 'string') captionUrl = data.url
    })

    /** Cold <track> elements fetch and parse in parallel with the first read, so
     *  one synchronous call reliably returns nothing. Poll instead of listening
     *  for `load`, because script-created tracks (hls.js, video.js, ...) never
     *  fire it. */
    const cuesFromTracksWhenReady = async (video: HTMLVideoElement): Promise<Cue[]> => {
      const deadline = Date.now() + 3000
      for (;;) {
        const cues = cuesFromTextTracks(video)
        if (cues.length > 0) return cues
        if (Date.now() >= deadline) return []
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }

    const loadCues = async (video: HTMLVideoElement): Promise<Cue[]> => {
      if (captionUrl !== null) {
        const res = (await chrome.runtime.sendMessage({ type: 'fetch-caption', url: captionUrl })) as {
          text?: string
        }
        if (typeof res?.text === 'string') {
          const cues = parseVtt(res.text)
          if (cues.length > 0) return cues
        }
      }
      return cuesFromTracksWhenReady(video)
    }

    const translateAll = async (video: HTMLVideoElement) => {
      for (const batch of planBatches(segments, video.currentTime)) {
        const res = (await chrome.runtime.sendMessage({ type: 'translate', batch })) as TranslateResponse
        if (res?.error) {
          console.warn('[udemy-dubbing]', res.error)
          showNotice(res.error)
          if (res.fatal) return
          continue
        }
        for (const [id, vi] of res.translations ?? []) {
          const seg = segments.find((s) => s.id === id)
          if (seg) {
            seg.viText = vi
            seg.status = 'ready'
          }
        }
        scheduler?.setSegments(segments)
      }
    }

    const loop = () => {
      void scheduler?.tick()
      rafId = requestAnimationFrame(loop)
    }

    bridge.on('attached', async (video) => {
      // A throwing/rejecting handler must not escape into the bridge's
      // emit() loop — bridge.start() calls scan() synchronously, and this
      // handler is async, so an uncaught rejection here would never be seen
      // by anything.
      try {
        const cues = await loadCues(video)
        if (cues.length === 0) {
          console.warn('[udemy-dubbing] Bài giảng này không có phụ đề.')
          return
        }

        segments = mergeCues(cues)
        scheduler = new Scheduler({ video, provider })
        scheduler.setSegments(segments)
        scheduler.setBaseline(video.playbackRate)

        cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(loop)

        void translateAll(video)
      } catch (e) {
        console.error('[udemy-dubbing] xử lý attached thất bại', e)
      }
    })

    bridge.on('seeked', () => scheduler?.onSeek())
    bridge.on('ratechange', (rate) => {
      // The scheduler writes playbackRate itself while stretching; those writes
      // fire ratechange too, and latching one as the viewer's choice would drag
      // the baseline down 15% every stretched sentence.
      if (scheduler?.isOwnRate(rate)) return
      scheduler?.setBaseline(rate)
    })
    bridge.on('detached', () => {
      cancelAnimationFrame(rafId)
      scheduler?.stop()
      scheduler = null
      captionUrl = null
    })

    bridge.start()
  },
})
