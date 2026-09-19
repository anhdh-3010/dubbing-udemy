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
