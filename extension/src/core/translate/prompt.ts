import type { Segment } from '../types'

/** Bumped whenever the rules below change in a way that would change
 *  output: the IT-terminology rules, the length budget, the voice. Cached
 *  translations were produced under the rules in force at the time, so this
 *  has to be part of `translationKey`'s cache key (core/cache-policy.ts) or
 *  old output silently survives a rule change.
 *
 *  BUMP THIS whenever you edit the rules below. */
export const PROMPT_VERSION = 1

export function buildPrompt(batch: Segment[]): string {
  const lines = batch
    .map((s) => `  { "id": ${s.id}, "seconds": ${(s.end - s.start).toFixed(1)}, "en": ${JSON.stringify(s.srcText)} }`)
    .join(',\n')

  return `You translate the narration of a programming course from English into Vietnamese.

Rules:
1. Keep IT terminology in English. Do not translate technology names, library
   names, language keywords, or terms Vietnamese developers normally say in
   English.
   Correct:   "hôm nay chúng ta sẽ triển khai một project React với backend là FastAPI"
   Incorrect: "hôm nay chúng ta sẽ hiện thực một dự án phản ứng với hậu trường nhanh api"
2. Keep each translation within about 15% of the time budget given by
   "seconds". Prefer the shorter phrasing when both read naturally, because the
   audio has to fit the original slot.
3. Write the way an instructor speaks, not the way a document reads.
4. Translate every entry. Never merge or drop entries.

Return raw JSON only — an array of objects with "id" and "vi". No markdown
fences, no commentary.

Input:
[
${lines}
]`
}
