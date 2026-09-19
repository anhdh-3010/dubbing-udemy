import { CAPTION_MESSAGE, installCaptionHook } from '../player/caption-hook'

export default defineContentScript({
  matches: ['https://www.udemy.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installCaptionHook(window, (url) => {
      window.postMessage({ type: CAPTION_MESSAGE, url }, window.location.origin)
    })
  },
})
