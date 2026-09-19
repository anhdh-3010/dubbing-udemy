import { planBatches } from '../core/batching'
import { Scheduler } from '../core/scheduler'
import { mergeCues } from '../core/segmenter'
import type { Cue, Segment } from '../core/types'
import { parseVtt } from '../core/vtt'
import { CAPTION_MESSAGE } from '../player/caption-hook'
import { cuesFromTextTracksWhenReady } from '../player/caption-source'
import { createPlayerBridge } from '../player/player-bridge'
import { WebSpeechProvider } from '../providers/web-speech'
import type { TranslateResponse } from './background'

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
    // Bumped by teardown(), which runs on every 'detached' and
    // 'lectureChanged'. A stale attach()/translateAll() from a lecture the
    // viewer has already left captures the generation it started with and
    // compares against this on every resume, so it can recognise itself as
    // obsolete instead of writing into the next lecture's segments/scheduler.
    let generation = 0

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
      }
      // Lectures are watched fullscreen; an element appended to <body> is
      // invisible then, so it must live inside whatever element currently
      // owns fullscreen.
      const host = document.fullscreenElement ?? document.body
      if (noticeEl.parentElement !== host) host.appendChild(noticeEl)
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

    /** Fetches and parses the VTT at the current `captionUrl`, or `[]` if
     *  there isn't one or the fetch/parse comes up empty. */
    const fetchVttCues = async (): Promise<Cue[]> => {
      if (captionUrl === null) return []
      const res = (await chrome.runtime.sendMessage({ type: 'fetch-caption', url: captionUrl })) as {
        text?: string
      }
      return typeof res?.text === 'string' ? parseVtt(res.text) : []
    }

    const loadCues = async (video: HTMLVideoElement): Promise<Cue[]> => {
      const first = await fetchVttCues()
      if (first.length > 0) return first

      // The player mounts <video> before it requests its VTT, so a caption
      // URL can show up after this point. Abort the <track> poll the moment
      // that happens and retry the VTT path with it, rather than declaring
      // the lecture caption-less because native <track> elements were never
      // how this player renders captions in the first place.
      const urlAtStart = captionUrl
      const cues = await cuesFromTextTracksWhenReady(video, {
        abortWhen: () => captionUrl !== urlAtStart,
      })
      if (cues.length > 0) return cues
      if (captionUrl !== null && captionUrl !== urlAtStart) return fetchVttCues()
      return cues
    }

    /** Translates every pending batch for one lecture. `segs` and `sched` are
     *  bound at call time, not read from the enclosing closure: by the time a
     *  `sendMessage` round trip resolves, the viewer may already be on a
     *  different lecture, and `segments`/`scheduler` would then refer to
     *  *that* one. `gen` is what actually detects the switch and stops. */
    const translateAll = async (
      video: HTMLVideoElement,
      segs: Segment[],
      sched: Scheduler,
      gen: number,
    ): Promise<void> => {
      for (const batch of planBatches(segs, video.currentTime)) {
        const res = (await chrome.runtime.sendMessage({ type: 'translate', batch })) as TranslateResponse

        // The viewer may have moved to another lecture while this request
        // was in flight. Nothing downstream would ever read a translation
        // written now, and every further batch would just repeat the waste.
        if (gen !== generation) return

        if (res?.error) {
          console.warn('[udemy-dubbing]', res.error)
          showNotice(res.fatal ? res.error : `Lỗi dịch phụ đề: ${res.error}`)
          if (res.fatal) return
          continue
        }
        for (const [id, vi] of res?.translations ?? []) {
          const seg = segs.find((s) => s.id === id)
          if (seg) {
            seg.viText = vi
            seg.status = 'ready'
          }
        }
        // `sched` already holds `segs` by reference (set once in attach()),
        // and these entries were mutated in place above, so there is
        // nothing further to hand it here.
      }
    }

    const loop = () => {
      void scheduler?.tick()
      rafId = requestAnimationFrame(loop)
    }

    /** Ends whatever lecture is current. Bumps `generation` first so any
     *  attach()/translateAll() still in flight for it recognises itself as
     *  stale as soon as it next checks. */
    const teardown = (): void => {
      generation++
      cancelAnimationFrame(rafId)
      scheduler?.stop()
      scheduler = null
      captionUrl = null
      segments = []
    }

    const attach = async (video: HTMLVideoElement): Promise<void> => {
      const gen = generation
      // A throwing/rejecting handler must not escape into the bridge's
      // emit() loop — bridge.start() calls scan() synchronously, and this
      // handler is async, so an uncaught rejection here would never be seen
      // by anything.
      try {
        const cues = await loadCues(video)
        if (gen !== generation) return // the viewer already left this lecture

        if (cues.length === 0) {
          console.warn('[udemy-dubbing] Bài giảng này không có phụ đề.')
          showNotice('Bài giảng này không có phụ đề.')
          return
        }

        if (!(await provider.isAvailable())) {
          showNotice('Không có giọng đọc tiếng Việt trên trình duyệt này, lồng tiếng có thể không đúng.')
        }
        if (gen !== generation) return

        const segs = mergeCues(cues)
        segments = segs

        // Belt-and-suspenders: teardown() should already have stopped and
        // cleared any previous scheduler before this generation started, but
        // a scheduler must never be replaced without stopping the one it
        // displaces first.
        scheduler?.stop()
        const sched = new Scheduler({ video, provider })
        scheduler = sched
        sched.setSegments(segs)
        sched.setBaseline(video.playbackRate)

        cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(loop)

        void translateAll(video, segs, sched, gen).catch((e) => {
          // chrome.runtime.sendMessage rejects — rather than resolving to an
          // error payload — when the service worker is recycled mid-request
          // or the port closes. Left unhandled, that would silently end all
          // further translation for the rest of the lecture, exactly what
          // the res.fatal handling above exists to prevent.
          console.warn('[udemy-dubbing]', e)
          showNotice('Lỗi dịch phụ đề.')
        })
      } catch (e) {
        console.error('[udemy-dubbing] xử lý attached thất bại', e)
      }
    }

    bridge.on('attached', attach)
    bridge.on('seeked', () => scheduler?.onSeek())
    bridge.on('ratechange', (rate) => {
      // The scheduler writes playbackRate itself while stretching; those writes
      // fire ratechange too, and latching one as the viewer's choice would drag
      // the baseline down 15% every stretched sentence.
      if (scheduler?.isOwnRate(rate)) return
      scheduler?.setBaseline(rate)
    })
    bridge.on('detached', teardown)
    bridge.on('lectureChanged', () => {
      // Udemy's SPA can reuse the same <video> element across lectures, in
      // which case scan() never sees a different element and 'detached'/
      // 'attached' never fire at all. lectureChanged is the only signal in
      // that case, and must drive the same teardown+attach cycle.
      teardown()
      if (bridge.video) void attach(bridge.video)
    })

    bridge.start()
  },
})
