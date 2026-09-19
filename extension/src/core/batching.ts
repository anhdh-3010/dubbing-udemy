import type { Segment } from './types'

export const DEFAULT_BATCH_SIZE = 40

/**
 * Splits untranslated segments into batches, putting the batch that covers
 * `currentTime` first so audio can start within a few seconds. The rest stay
 * in playback order.
 */
export function planBatches(
  segments: Segment[],
  currentTime: number,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Segment[][] {
  const pending = segments.filter((s) => s.status !== 'ready')
  if (pending.length === 0) return []

  const batches: Segment[][] = []
  for (let i = 0; i < pending.length; i += Math.max(1, batchSize)) {
    batches.push(pending.slice(i, i + batchSize))
  }

  const currentIndex = batches.findIndex(
    (b) => currentTime < b[b.length - 1].end && currentTime >= b[0].start,
  )
  if (currentIndex > 0) {
    const [current] = batches.splice(currentIndex, 1)
    batches.unshift(current)
  }

  return batches
}
