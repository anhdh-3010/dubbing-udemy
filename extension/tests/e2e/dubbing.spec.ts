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

    // `health` above only proves *some* server on port 5599 answered 200 —
    // indistinguishable from this test having silently reached the *real*
    // server on 8770 instead, if the `--mode e2e` TTS_BASE_URL redirection
    // (tts.ts) ever broke. The real launchd agent stays up on this machine
    // throughout, so that failure would not even error, just quietly test
    // against production. Hit /health directly and check the stub's own
    // marker (scripts/serve-fixtures.mjs) to prove this ran against the stub.
    const rawHealth = (await page.evaluate(() =>
      fetch('http://127.0.0.1:5599/health').then((r) => r.json()),
    )) as { status?: string; model_loaded?: boolean; stub?: boolean }
    expect(rawHealth.stub).toBe(true)

    const spoken = (await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'tts-speak',
        text: 'Xin chào, đây là một component React.',
      }),
    )) as { audio?: string; duration?: number; error?: string }

    expect(spoken.error).toBeUndefined()
    expect(spoken.duration).toBeGreaterThan(0)
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
