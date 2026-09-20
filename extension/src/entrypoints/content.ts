import { planBatches } from '../core/batching'
import { FallbackProvider } from '../core/fallback'
import { Scheduler } from '../core/scheduler'
import { mergeCues } from '../core/segmenter'
import type { Cue, Segment } from '../core/types'
import { parseVtt } from '../core/vtt'
import { CAPTION_MESSAGE } from '../player/caption-hook'
import { cuesFromTextTracks, cuesFromTextTracksWhenReady } from '../player/caption-source'
import { createPlayerBridge, lectureIdFromUrl } from '../player/player-bridge'
import { VieNeuProvider } from '../providers/vieneu'
import { WebSpeechProvider } from '../providers/web-speech'
import type { TranslateResponse } from './background'

/** Cheap fingerprint of a cue list: count plus first/last text is enough to
 *  tell "the tracks still show what they showed a moment ago" from "the
 *  tracks now show something else" without comparing full cue arrays. */
const cueSignature = (cues: Cue[]): string =>
  cues.length === 0 ? '' : `${cues.length}|${cues[0].text}|${cues[cues.length - 1].text}`

export default defineContentScript({
  // lg.udemy.com is where the lecture player actually runs, observed on
  // live traffic; www.udemy.com is kept in case Udemy still serves the
  // course-taking UI there for some users/regions.
  matches: ['https://www.udemy.com/*', 'https://lg.udemy.com/*'],
  runAt: 'document_idle',

  main() {
    const bridge = createPlayerBridge(document)

    let scheduler: Scheduler | null = null
    let rafId = 0
    let captionUrl: string | null = null
    // Bumped by teardown(), which runs on every 'detached' and
    // 'lectureChanged'. A stale attach()/translateAll() from a lecture the
    // viewer has already left captures the generation it started with and
    // compares against this on every resume, so it can recognise itself as
    // obsolete instead of writing into the next lecture's segments/scheduler.
    let generation = 0
    // What loadCues's <track> poll showed on the *outgoing* video the last
    // time a lecture ended, so a lectureChanged reattach onto the same
    // element (Udemy can reuse one <video> across lectures) can tell that
    // apart from the new lecture's own cues once they show up.
    let staleTrackSignature: string | null = null
    // The lecture id attach() last committed to. Lets lectureChanged no-op
    // when the ordinary attached path already handled this lecture (the
    // element swap and the URL update can be observed in different scans).
    let attachedLectureId: string | null = null

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

    // Held separately from `provider` because warmUp() is VieNeu's own,
    // not part of the TTSProvider interface.
    const vieneu = new VieNeuProvider()

    const provider = new FallbackProvider(vieneu, new WebSpeechProvider(), {
      onStatusChange: (status) => {
        showNotice(
          status === 'fallback'
            ? 'Server TTS ngừng trả lời. Giọng dự phòng của trình duyệt thường im lặng trên máy này — chạy lại server rồi tải lại trang.'
            : 'Server TTS đã trở lại.',
        )
      },
    })

    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = event.data as { type?: string; url?: string }
      if (data?.type === CAPTION_MESSAGE && typeof data.url === 'string') captionUrl = data.url
    })

    /** Fetches and parses the VTT at the current `captionUrl`, or `[]` if
     *  there isn't one or the fetch/parse comes up empty.
     *
     *  An allowlist rejection, a blocked redirect, a CDN 403, and a plain
     *  network error all come back as `{ error }` from the service worker.
     *  Surfacing that (instead of silently returning `[]`, indistinguishable
     *  from "this lecture genuinely has no captions") is what lets whoever
     *  is watching this run tell those apart from the `<track>` fallback's
     *  own "no subtitles" outcome. */
    const fetchVttCues = async (): Promise<Cue[]> => {
      if (captionUrl === null) return []
      const res = (await chrome.runtime.sendMessage({ type: 'fetch-caption', url: captionUrl })) as {
        text?: string
        error?: string
      }
      if (res?.error) {
        console.warn('[udemy-dubbing]', res.error)
        showNotice(`Lỗi tải phụ đề: ${res.error}`)
        return []
      }
      return typeof res?.text === 'string' ? parseVtt(res.text) : []
    }

    /** `accept`, when given, additionally rejects a candidate that turns out
     *  to be stale (see the `lectureChanged` wiring below); it defaults to
     *  "non-empty" wherever it isn't threaded through explicitly. */
    const loadCues = async (
      video: HTMLVideoElement,
      accept: (cues: Cue[]) => boolean = (cues) => cues.length > 0,
    ): Promise<Cue[]> => {
      const first = await fetchVttCues()
      if (first.length > 0) return first

      // The player mounts <video> before it requests its VTT, so a caption
      // URL can show up after this point. Abort the <track> poll the moment
      // that happens and retry the VTT path with it, rather than declaring
      // the lecture caption-less because native <track> elements were never
      // how this player renders captions in the first place.
      const urlAtStart = captionUrl
      const polled = await cuesFromTextTracksWhenReady(video, {
        abortWhen: () => captionUrl !== urlAtStart,
        accept,
      })
      if (polled.length > 0) return polled

      if (captionUrl !== null && captionUrl !== urlAtStart) {
        const retried = await fetchVttCues()
        if (retried.length > 0) return retried
      }

      // Whatever emptied out above — an aborted poll (which discards any
      // non-English cues it had in hand under requireEnglish), a deadline
      // that genuinely found nothing acceptable, or a VTT retry that also
      // came back empty — one final permissive read before declaring the
      // lecture caption-less. Still gated by `accept`: for the
      // lectureChanged path this must not hand back the previous lecture's
      // cues just because the poll gave up.
      const fallback = cuesFromTextTracks(video)
      return accept(fallback) ? fallback : []
    }

    /** Translates every pending batch for one lecture. `segs` is bound at
     *  call time, not read from an enclosing closure: by the time a
     *  `sendMessage` round trip resolves, the viewer may already be on a
     *  different lecture, and a closure variable would then refer to *that*
     *  one. `gen` is what actually detects the switch and stops. */
    const translateAll = async (video: HTMLVideoElement, segs: Segment[], gen: number): Promise<void> => {
      for (const batch of planBatches(segs, video.currentTime)) {
        let res: TranslateResponse
        try {
          res = (await chrome.runtime.sendMessage({ type: 'translate', batch })) as TranslateResponse
        } catch (e) {
          // chrome.runtime.sendMessage rejects — rather than resolving to an
          // error payload — when the service worker is recycled mid-request
          // or the message port closes. That must not end translation for
          // the rest of the lecture any more than a res.error does: warn and
          // move on to the next batch.
          console.warn('[udemy-dubbing]', e)
          continue
        }

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
        // The scheduler already holds `segs` by reference (set once in
        // attach()), and these entries were mutated in place above, so
        // there is nothing further to hand it here.
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
      // Snapshot whatever the (possibly about-to-be-reused) video's native
      // tracks show right now, before anything about the next lecture has
      // had a chance to load — see the `accept` passed to attach() from
      // 'lectureChanged' below.
      staleTrackSignature = bridge.video ? cueSignature(cuesFromTextTracks(bridge.video)) : null
      captionUrl = null
    }

    const attach = async (video: HTMLVideoElement, accept?: (cues: Cue[]) => boolean): Promise<void> => {
      const gen = generation
      // A throwing/rejecting handler must not escape into the bridge's
      // emit() loop — bridge.start() calls scan() synchronously, and this
      // handler is async, so an uncaught rejection here would never be seen
      // by anything. Everything this function does, including the
      // attachedLectureId bookkeeping, stays inside this try.
      try {
        attachedLectureId = lectureIdFromUrl(window.location.href)
        const cues = await loadCues(video, accept)
        if (gen !== generation) return // the viewer already left this lecture

        if (cues.length === 0) {
          console.warn('[udemy-dubbing] Bài giảng này không có phụ đề.')
          showNotice('Bài giảng này không có phụ đề.')
          return
        }

        const voiceAvailable = await provider.isAvailable()
        if (gen !== generation) return // don't toast lecture A's voice check over lecture B
        if (!voiceAvailable) {
          // Both engines are out. Saying "the browser fallback will be used"
          // here would be a lie by omission: on this machine
          // speechSynthesis.speak() produces nothing at all, so the honest
          // message names the thing that can actually be fixed.
          showNotice('Chưa có giọng đọc: server TTS không chạy. Chạy server/install-agent.sh rồi tải lại trang.')
        } else if (provider.status === 'primary') {
          // Not awaited. The server needs about 4.3s to load the model and
          // another ~1.8s for its first inference; the point is to spend
          // that now, while the first translation batch is in flight,
          // instead of on the lecture's first sentence.
          void vieneu.warmUp()
        }

        const segs = mergeCues(cues)

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

        void translateAll(video, segs, gen).catch((e) => {
          // The per-batch sendMessage rejection (service worker recycled
          // mid-request, port closed) is now caught and skipped inside
          // translateAll's loop, so it no longer reaches here. This backstop
          // is for anything else that makes the translateAll promise itself
          // reject — a bug in the loop body, for instance — so one such
          // failure is reported instead of becoming an unhandled rejection.
          // Still gated on generation: this can land after the viewer has
          // moved on, and lecture A's failure must not toast over lecture B.
          if (gen !== generation) return
          console.warn('[udemy-dubbing]', e)
          showNotice('Lỗi dịch phụ đề.')
        })
      } catch (e) {
        console.error('[udemy-dubbing] xử lý attached thất bại', e)
        if (gen === generation) showNotice('Có lỗi khi xử lý bài giảng.')
      }
    }

    bridge.on('attached', attach)
    bridge.on('seeked', () => scheduler?.onSeek())
    bridge.on('pause', () => scheduler?.onPause())
    bridge.on('ratechange', (rate) => {
      // The scheduler writes playbackRate itself while stretching; those writes
      // fire ratechange too, and latching one as the viewer's choice would drag
      // the baseline down 15% every stretched sentence.
      if (scheduler?.isOwnRate(rate)) return
      scheduler?.setBaseline(rate)
    })
    bridge.on('detached', teardown)
    bridge.on('lectureChanged', (id) => {
      // Belt-and-braces guard, not a fix for an observed defect: in scan(),
      // the lectureChanged emit always precedes the element-identity check
      // that would update attach()'s bookkeeping for this id, so by the time
      // this handler runs, attachedLectureId cannot yet equal `id` in any of
      // the currently known navigation orderings — this branch does not fire
      // today. Kept in case a future reordering of scan() (or a new caller
      // of attach()) makes it reachable; removing it would cost nothing now
      // but risks silently reintroducing the duplicate teardown+attach this
      // was meant to prevent.
      if (id === attachedLectureId) return

      // Udemy's SPA can otherwise reuse the same <video> element across
      // lectures, in which case scan() never sees a different element and
      // 'detached'/'attached' never fire at all — lectureChanged is the
      // only signal in that case. teardown() below records what the
      // element's tracks show *right now* (still lecture A's, since nothing
      // has changed yet) into staleTrackSignature; read it only after
      // teardown() has run, so it's this transition's snapshot and not a
      // leftover from an earlier one.
      teardown()
      const stale = staleTrackSignature
      if (bridge.video) {
        const video = bridge.video
        void attach(video, (cues) => cues.length > 0 && cueSignature(cues) !== stale)
      }
    })

    bridge.start()
  },
})
