export interface WindowLike {
  fetch: typeof fetch
}

export const CAPTION_MESSAGE = 'udemy-dubbing:caption-url'

const VTT_URL = /\.vtt(?:$|\?)/i

/**
 * MV3 removed blocking webRequest and never let extensions read response
 * bodies, so the only way to see the caption file the page loads is to wrap
 * fetch in the page's own world and report the URL. The service worker then
 * fetches that URL itself, with credentials.
 *
 * Returns a function that restores the original fetch.
 */
export function installCaptionHook(win: WindowLike, onUrl: (url: string) => void): () => void {
  const original = win.fetch

  win.fetch = function patched(this: unknown, ...args: Parameters<typeof fetch>) {
    const input = args[0]
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (VTT_URL.test(url)) {
      try {
        onUrl(url)
      } catch {
        // Reporting must never break the page's own request.
      }
    }
    return original.apply(this, args)
  } as typeof fetch

  return () => {
    win.fetch = original
  }
}
