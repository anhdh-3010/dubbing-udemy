import { CAPTION_MESSAGE, installCaptionHook, isCaptionUrlAllowed } from '../player/caption-hook'

export default defineContentScript({
  matches: ['https://www.udemy.com/*'],
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
