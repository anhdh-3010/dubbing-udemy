import { CAPTION_MESSAGE, installCaptionHook, isCaptionUrlAllowed } from '../player/caption-hook'

export default defineContentScript({
  matches: [
    'https://www.udemy.com/*',
    // The e2e fixture origin (tests/e2e/dubbing.spec.ts), served locally by
    // the Playwright webServer so the pipeline can be exercised end to end
    // without a real Udemy account.
    'http://127.0.0.1:5599/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installCaptionHook(window, (url) => {
      const absolute = new URL(url, window.location.href).href
      if (!isCaptionUrlAllowed(absolute)) return
      window.postMessage({ type: CAPTION_MESSAGE, url: absolute }, window.location.origin)
    })
  },
})
