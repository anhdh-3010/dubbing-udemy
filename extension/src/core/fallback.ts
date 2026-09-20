import type { TTSProvider, Utterance } from './types'

export type ProviderStatus = 'primary' | 'fallback'

export interface FallbackOptions {
  /** How long to stay on the backup before giving the primary another go. */
  cooldownMs?: number
  /** Injected so tests can move time without waiting for it. */
  now?: () => number
  /** Called only when the status actually changes, never once per sentence. */
  onStatusChange?: (status: ProviderStatus, reason: string) => void
}

const DEFAULT_COOLDOWN_MS = 30_000

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

/**
 * Two engines behind one TTSProvider (spec 8.4).
 *
 * The scheduler is the hardest part of this system already; teaching it that
 * there are two engines and which one is currently alive would make it
 * harder for no gain. Everything about switching lives here instead, where
 * it is pure enough to test without a browser.
 */
export class FallbackProvider implements TTSProvider {
  readonly name = 'fallback'

  private readonly cooldownMs: number
  private readonly now: () => number
  private readonly onStatusChange: (status: ProviderStatus, reason: string) => void

  /** When the primary was last seen failing, or null while it is trusted. */
  private downSince: number | null = null
  /** The last status handed to onStatusChange. Starts at 'primary' so a
   *  healthy run says nothing at all. */
  private announced: ProviderStatus = 'primary'

  constructor(
    private readonly primary: TTSProvider,
    private readonly backup: TTSProvider,
    opts: FallbackOptions = {},
  ) {
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS
    this.now = opts.now ?? (() => Date.now())
    this.onStatusChange = opts.onStatusChange ?? (() => {})
  }

  get status(): ProviderStatus {
    return this.downSince === null ? 'primary' : 'fallback'
  }

  get knowsDurationAhead(): boolean {
    return this.active.knowsDurationAhead
  }

  private get active(): TTSProvider {
    return this.downSince === null ? this.primary : this.backup
  }

  async isAvailable(): Promise<boolean> {
    if (await this.primary.isAvailable()) {
      this.markUp('server TTS đang chạy')
      return true
    }
    this.markDown('server TTS không trả lời')
    return this.backup.isAvailable()
  }

  async prepare(text: string, signal: AbortSignal): Promise<Utterance> {
    if (this.downSince !== null && this.now() - this.downSince >= this.cooldownMs) {
      // Cooldown is up. Clearing it here rather than on a timer means the
      // retry happens on the next sentence that actually needs speech.
      this.downSince = null
    }

    if (this.downSince === null) {
      try {
        const utterance = await this.primary.prepare(text, signal)
        this.markUp('server TTS đã trở lại')
        return utterance
      } catch (e) {
        // A seek cancels whatever was being prepared. That is the viewer
        // moving, not the server breaking, and dropping a working engine
        // every time someone scrubs would be its own bug.
        if (isAbort(e)) throw e
        this.markDown(e instanceof Error ? e.message : String(e))
      }
    }

    return this.backup.prepare(text, signal)
  }

  private markDown(reason: string): void {
    this.downSince = this.now()
    if (this.announced === 'fallback') return
    this.announced = 'fallback'
    this.onStatusChange('fallback', reason)
  }

  private markUp(reason: string): void {
    this.downSince = null
    if (this.announced === 'primary') return
    this.announced = 'primary'
    this.onStatusChange('primary', reason)
  }
}
