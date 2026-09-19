import type { Segment } from '../types'

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
