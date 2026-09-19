import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'

// package.json has "type": "module", so this file runs as an ES module and
// has no __dirname — derive the equivalent from import.meta.url instead.
const dirname = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.resolve(dirname, '../../.output/chrome-mv3')

// Verified empirically against the Chromium build Playwright downloads
// (Chrome for Testing 153.0.8010.12): with `headless: true` the extension
// never loads at all — no service worker registers, no content script runs,
// the fixture page stays untouched — so this must run headed. Kept as a
// named constant, and set here rather than in playwright.config.ts's `use`
// block, because this suite launches its own persistent context via
// chromium.launchPersistentContext() instead of through Playwright's
// browser/context/page fixtures — `use.headless` is never consulted for a
// manual launch like this one. See playwright.config.ts for the full note.
//
// Consequence for CI: a CI runner without a display needs a virtual one
// (e.g. `xvfb-run`) to run this suite, since headless cannot substitute here.
const HEADLESS = false

const MISSING_KEY_NOTICE = 'Chưa có API key. Mở trang cài đặt để nhập.'
const NO_SUBTITLES_NOTICE = 'Bài giảng này không có phụ đề.'

test('reaches the missing-API-key notice after the caption pipeline runs end to end', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: HEADLESS,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })

  try {
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:5599/lecture.html')

    // No API key is configured in this fresh profile, so a fully working
    // pipeline ends here — and getting here proves the whole chain ran:
    // the content script attached to the fixture's <video> (player-bridge),
    // the caption path produced cues (via the native <track> poll — the
    // fixture's own fetch('./sample.vtt') reaches the MAIN-world hook, but
    // isCaptionUrlAllowed rejects http://127.0.0.1:5599/sample.vtt as the
    // wrong scheme/host, same as it would on real Udemy for a foreign URL),
    // mergeCues produced segments, planBatches produced a batch, and the
    // content script round-tripped that batch to the service worker and
    // back. The caption poll alone can take up to 3s, hence the generous
    // timeout.
    await expect(page.getByText(MISSING_KEY_NOTICE, { exact: true })).toBeVisible({
      timeout: 10_000,
    })

    // The two notices share one on-page element (content.ts's showNotice),
    // so if the caption path had broken instead, this text — not the one
    // above — would be showing right now. Asserting its absence is what
    // makes this test able to fail: it is the one thing that would be
    // different if the pipeline never reached the caption/segment/batch
    // machinery at all.
    await expect(page.getByText(NO_SUBTITLES_NOTICE, { exact: true })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
