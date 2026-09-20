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

const CAPTION_HOSTS = /(^|\.)udemy\.com$|(^|\.)udemycdn\.com$/i

/**
 * Udemy's caption CDN path always carries a locale segment immediately
 * before the filename (e.g. `/25721448/en_GB/....vtt`). The scrubber's
 * hover-preview thumbnail track is also a `.vtt` file on an allowed host,
 * but its path has no locale segment (e.g. `/<asset>/1/thumb-sprites.vtt`).
 * Requiring the locale segment excludes that sprite track without touching
 * the host allowlist.
 */
const LOCALE_VTT_PATH = /\/([a-z]{2}(?:_[A-Z]{2})?)\/[^/]+\.vtt$/

/**
 * The service worker fetches reported URLs with the user's cookies, so a
 * forged report must not become a credentialed request to an arbitrary host
 * — or to an arbitrary path on an allowed host. Both the reporter and the
 * fetcher check this.
 */
export function isCaptionUrlAllowed(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      CAPTION_HOSTS.test(url.hostname) &&
      VTT_URL.test(url.pathname) &&
      LOCALE_VTT_PATH.test(url.pathname)
    )
  } catch {
    return false
  }
}
