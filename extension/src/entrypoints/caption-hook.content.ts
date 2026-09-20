import { CAPTION_MESSAGE, installCaptionHook, isCaptionUrlAllowed } from '../player/caption-hook'

export default defineContentScript({
  // lg.udemy.com is where the lecture player actually runs, observed on
  // live traffic; www.udemy.com is kept in case Udemy still serves the
  // course-taking UI there for some users/regions.
  matches: ['https://www.udemy.com/*', 'https://lg.udemy.com/*'],
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
