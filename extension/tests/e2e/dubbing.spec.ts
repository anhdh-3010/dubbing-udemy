import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'

// package.json has "type": "module", so this file runs as an ES module and
// has no __dirname — derive the equivalent from import.meta.url instead.
const dirname = path.dirname(fileURLToPath(import.meta.url))
// "test:e2e" runs `wxt build --mode e2e` first. That mode gets a manifest
// with the fixture origin in every content script's `matches` (see the
// `build:manifestGenerated` hook in wxt.config.ts) — a grant that must not
// ship in the real, `--mode production` build — and WXT's default
// outDirTemplate appends "-{{mode}}" for any non-development/production
// mode, so this build lands in .output/chrome-mv3-e2e, not .output/chrome-mv3.
const EXT = path.resolve(dirname, '../../.output/chrome-mv3-e2e')

// Verified empirically against the Chromium build `npx playwright install
// chromium` downloads (Chrome for Testing 153.0.8010.12): plain
// `headless: true` makes Playwright launch the extension-incapable
// `chromium-headless-shell` binary instead of full Chrome, so
// `--load-extension` is a silent no-op — no service worker ever registers.
// Adding `channel: 'chromium'` makes Playwright pick the full Chrome-for-
// Testing binary it already downloaded, which supports both extensions and
// `--headless` (new headless, present since Chrome 126; this is 153) — the
// extension's service worker registers and the run below passes headless.
// If this ever regresses, the fallback is `headless: false` plus
// `xvfb-run -a npm run test:e2e` in CI.
const HEADLESS = true
const CHANNEL = 'chromium'

const MISSING_KEY_NOTICE = 'Chưa có API key. Mở trang cài đặt để nhập.'
const NO_SUBTITLES_NOTICE = 'Bài giảng này không có phụ đề.'

// Exercises player-bridge.ts's lectureIdFromUrl bookkeeping
// (attachedLectureId, the lectureChanged wiring) rather than a bare static
// file, which would leave lectureId permanently null and skip that machinery
// entirely. See scripts/serve-fixtures.mjs's LECTURE_ROUTE.
const FIXTURE_URL = 'http://127.0.0.1:5599/learn/lecture/12345'

test('reaches the missing-API-key notice via the native <track> caption fallback', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: HEADLESS,
    channel: CHANNEL,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })

  try {
    // "The extension never loaded" and "the caption path broke" both surface
    // downstream as the same "notice never appeared" symptom. Failing here
    // first, with its own clear message, rules the former out before the
    // page-level assertions below run.
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }))
    expect(serviceWorker.url()).toContain('background.js')

    const page = await context.newPage()
    await page.goto(FIXTURE_URL)

    // No API key is configured in this fresh profile, so a fully working
    // pipeline ends here — and getting here proves the whole chain ran: the
    // content script attached to the fixture's <video> (player-bridge), the
    // native <track> poll produced English cues (NOT the VTT-fetch path —
    // the fixture's own fetch('/sample.vtt') does reach the MAIN-world hook,
    // but isCaptionUrlAllowed rejects http://127.0.0.1:5599/sample.vtt as
    // the wrong scheme/host, so that path stays at 0% coverage here; see
    // the DEFERRED note in task-15-report.md for what would close it),
    // mergeCues produced segments, planBatches produced a batch, and the
    // content script round-tripped that batch to the service worker and
    // back. The caption poll alone can take up to 3s, hence the generous
    // timeout.
    //
    // Asserted with toHaveText against a locator for the toast element
    // itself (content.ts's showNotice always renders as the only div
    // appended directly under <body> on this fixture — there is no static
    // <div> in tests/fixtures/lecture.html for it to collide with) rather
    // than a text-matching locator: on failure this prints whatever text
    // the toast actually holds — e.g. NO_SUBTITLES_NOTICE — instead of just
    // "element(s) not found", which is what actually distinguishes this
    // test from the one it replaced.
    const notice = page.locator('body > div')
    await expect(notice).toHaveText(MISSING_KEY_NOTICE, { timeout: 10_000 })

    // Dead as *additional* coverage — showNotice reuses one element, so if
    // NO_SUBTITLES_NOTICE were showing, the assertion above would already
    // have failed and reported it. Kept only as executable documentation of
    // the failure mode this test is meant to catch.
    await expect(notice).not.toHaveText(NO_SUBTITLES_NOTICE)
  } finally {
    await context.close()
  }
})

/** Launch options shared by the TTS tests. The autoplay flag matters:
 *  `new Audio().play()` is a programmatic play with no user gesture behind
 *  it, which Chrome blocks by default. `--mute-audio` keeps a CI machine
 *  quiet without stopping the decode. */
const TTS_LAUNCH_ARGS = [
  `--disable-extensions-except=${EXT}`,
  `--load-extension=${EXT}`,
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
]

/** The extension's own options page. A content script's isolated world is
 *  not reachable from page.evaluate, but an extension page is, and it has
 *  the same chrome.runtime access the content script uses. */
async function openExtensionPage(context: import('@playwright/test').BrowserContext) {
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }))
  const extensionId = new URL(serviceWorker.url()).host
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  return page
}

test('the service worker reaches the TTS server and returns playable audio', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: HEADLESS,
    channel: CHANNEL,
    args: TTS_LAUNCH_ARGS,
  })

  try {
    const page = await openExtensionPage(context)

    const health = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts-health' }))
    expect(health).toEqual({ ok: true })

    const spoken = (await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'tts-speak',
        text: 'Xin chào, đây là một component React.',
      }),
    )) as { audio?: string; duration?: number; error?: string }

    expect(spoken.error).toBeUndefined()
    // `health` above only proves *some* server on port 5599 answered 200 —
    // indistinguishable from this test having silently reached the *real*
    // server on 8770 instead, if the `--mode e2e` TTS_BASE_URL redirection
    // (tts.ts) ever broke: the real launchd agent stays up on this machine
    // throughout, so that failure would not even error, just quietly test
    // against production. A raw `fetch` to the stub's own /health from the
    // page (the previous version of this assertion) cannot catch that: the
    // URL there is hardcoded in the page and is a second, independent
    // connection that says nothing about which server the *service worker*
    // actually used for tts-speak above — both servers would be up and
    // answering on this machine regardless.
    //
    // Pin a value that only the stub can produce and that travels back
    // through the same round trip the extension itself takes.
    // scripts/serve-fixtures.mjs derives its clip length as
    // `Math.min(3, Math.max(0.2, input.length / 20))`, and the probe text
    // above is exactly 37 characters, so the stub always answers with
    // 37 / 20 = 1.85s. No real TTS engine synthesising this sentence would
    // land on that exact number, so seeing it here proves the response came
    // from the stub on 5599, not the real launchd server on 8770.
    expect(spoken.duration).toBeCloseTo(1.85)
    // The first four bytes of any WAV. Proves the base64 round trip through
    // sendMessage's JSON serialisation preserved the bytes — the one thing
    // spec 8.3 says cannot be taken for granted.
    expect(atob(spoken.audio!.slice(0, 8)).startsWith('RIFF')).toBe(true)
  } finally {
    await context.close()
  }
})

test('the page can play synthesised audio at the rate ceiling', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: HEADLESS,
    channel: CHANNEL,
    args: TTS_LAUNCH_ARGS,
  })

  try {
    const page = await openExtensionPage(context)

    const outcome = await page.evaluate(async () => {
      const res = (await chrome.runtime.sendMessage({
        type: 'tts-speak',
        text: 'Xin chào.',
      })) as { audio: string }

      const binary = atob(res.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
      const audio = new Audio(url)
      audio.preservesPitch = true
      audio.playbackRate = 1.4 // spec 6.2's ceiling — the worst case

      return new Promise<string>((resolve) => {
        audio.onended = () => resolve('ended')
        audio.onerror = () => resolve('error')
        setTimeout(() => resolve('timeout'), 8_000)
        audio.play().catch((e: Error) => resolve(`blocked: ${e.name}`))
      })
    })

    // Neither jsdom nor Node can exercise a real HTMLMediaElement, so this
    // is the only place the actual playback path is proven.
    expect(outcome).toBe('ended')
  } finally {
    await context.close()
  }
})

// Like the test above, this one is immune to a service worker that
// accidentally reaches the real launchd server on 8770 instead of the stub
// on 5599 — but by a different mechanism. That test pins an absolute value
// only the stub can produce (`spoken.duration` == 1.85s, derivable only from
// its exact clip-length formula). This one instead reads the stub's own
// `/stub/synth-count` counter through the extension page's own fetch and
// asserts on DELTAS: `before` and `before + 1`. A misdirected service worker
// would never move the stub's counter at all, so `before` and `before + 1`
// would be equal and the very first delta assertion below would fail loudly
// — it does not merely happen to pass by coincidence, the way an absolute
// count against an already-running stub could. This is worth writing down
// because it is invisible in the code: a refactor from deltas to absolute
// counts (e.g. asserting `synthCount() === 1` after a fresh stub restart)
// would compile, look equivalent, and quietly remove this safety property
// without any test going red to say so.
test('câu đã tổng hợp một lần thì lần sau lấy từ cache, không gọi server nữa', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: HEADLESS,
    channel: CHANNEL,
    args: TTS_LAUNCH_ARGS,
  })

  try {
    const page = await openExtensionPage(context)

    // An extension page's fetch to a host in host_permissions is exempt from
    // CORS, same as the service worker's — so the page can read the stub's
    // counter directly.
    const synthCount = (): Promise<number> =>
      page.evaluate(async () => {
        const res = await fetch('http://127.0.0.1:5599/stub/synth-count')
        return ((await res.json()) as { count: number }).count
      })

    const speak = (text: string): Promise<{ audio?: string; duration?: number; error?: string }> =>
      page.evaluate(
        (t) => chrome.runtime.sendMessage({ type: 'tts-speak', text: t }),
        text,
      ) as Promise<{ audio?: string; duration?: number; error?: string }>

    const before = await synthCount()

    const first = await speak('Một câu để kiểm tra cache.')
    expect(first.error).toBeUndefined()
    expect(await synthCount()).toBe(before + 1)

    const second = await speak('Một câu để kiểm tra cache.')
    expect(second.error).toBeUndefined()
    // The counter did not move: Chrome's own IndexedDB answered.
    expect(await synthCount()).toBe(before + 1)
    // And what it answered with is byte-for-byte what the server sent, all
    // the way through an ArrayBuffer round trip in IndexedDB and a base64
    // round trip through sendMessage's JSON.
    expect(second.audio).toBe(first.audio)
    expect(second.duration).toBe(first.duration)

    // A different sentence still reaches the server — proof the counter
    // counts, and that the cache is keyed on the text rather than answering
    // everything from one row.
    const other = await speak('Một câu khác hẳn.')
    expect(other.error).toBeUndefined()
    expect(await synthCount()).toBe(before + 2)
    expect(other.audio).not.toBe(first.audio)
  } finally {
    await context.close()
  }
})
