# M1 — Pipeline lồng tiếng chạy được

> **Dành cho agent thực thi:** BẮT BUỘC DÙNG SUB-SKILL `superpowers:subagent-driven-development` (khuyến nghị) hoặc `superpowers:executing-plans` để thực hiện plan này theo từng task. Các bước dùng cú pháp checkbox (`- [ ]`) để theo dõi.

**Mục tiêu:** Một bài giảng Udemy thật phát ra tiếng Việt, đồng bộ với video, không dừng hình.

**Kiến trúc:** Extension Chrome MV3. Content script giữ toàn bộ logic thời gian và phát tiếng; service worker giữ API key và gọi mạng; hai bên nói chuyện qua `chrome.runtime` port. M1 dùng Web Speech API làm giọng đọc để kiểm chứng bộ máy đồng bộ trước khi đưa server TTS vào ở M2.

**Tech stack:** TypeScript, WXT (framework MV3), Vitest (unit), Playwright (e2e), npm. Node v20.17.0 và npm 10.8.2 đã có sẵn trên máy; không có pnpm hay bun nên dùng npm.

**Spec:** `docs/superpowers/specs/2026-09-20-udemy-realtime-dubbing-design.md`

## Ràng buộc toàn cục

Áp dụng cho mọi task, không nhắc lại ở từng task:

- **Ngôn ngữ code và comment: tiếng Anh.** Chuỗi hiển thị cho người dùng: tiếng Việt.
- **Không thư viện ngoài nếu không thật sự cần.** M1 chỉ cần WXT, Vitest, Playwright, TypeScript.
- **`strict: true`** trong `tsconfig.json`. Không dùng `any` khi có kiểu cụ thể.
- **Mọi thứ trong `src/core/` phải thuần túy** — không chạm `window`, `document`, `chrome`, `fetch`. Đây là ranh giới làm cho phần khó nhất test được mà không cần trình duyệt.
- **Thuật ngữ IT giữ nguyên tiếng Anh trong bản dịch** (spec mục 7). Không phiên âm.
- **`baseline` là tốc độ phát người dùng đang chọn, không phải 1.0** (spec mục 6.2). Mọi phép tính co giãn tương đối theo nó.
- **Ngưỡng cố định:** tốc độ đọc TTS kẹp trong `[1.0, 1.4]`; sàn làm chậm video là `0.85 * baseline`; mức ducking mặc định `0.1`; trần độ dài một segment `12` giây.
- **Commit sau mỗi task**, dùng tiền tố `feat:`, `test:`, `chore:` theo Conventional Commits.

---

### Task 1: Dựng khung dự án

**Files:**
- Create: `extension/package.json`, `extension/tsconfig.json`, `extension/wxt.config.ts`, `extension/vitest.config.ts`
- Create: `extension/src/core/types.ts`
- Test: `extension/src/core/types.test.ts`

**Interfaces:**
- Consumes: không có
- Produces: các kiểu dùng chung cho mọi task sau — `Cue`, `Segment`, `SegmentStatus`, `Utterance`, `TTSProvider`, `VideoLike`

- [ ] **Step 1: Khởi tạo dự án WXT**

```bash
cd /Users/anhdh/dubbing
mkdir -p extension && cd extension
npm init -y
npm install --save-dev wxt typescript vitest @types/node
npx tsc --init
```

- [ ] **Step 2: Viết `wxt.config.ts`**

```ts
import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Udemy Dubbing',
    description: 'Lồng tiếng Việt cho bài giảng Udemy theo thời gian thực',
    permissions: ['storage'],
    host_permissions: [
      'https://www.udemy.com/*',
      'https://*.udemycdn.com/*',
      'http://127.0.0.1/*',
    ],
  },
})
```

- [ ] **Step 3: Viết `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Thêm scripts vào `package.json`**

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Trong `tsconfig.json`, đặt `"strict": true`.

- [ ] **Step 5: Viết test thất bại cho các kiểu dùng chung**

File `src/core/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isReady, type Segment } from './types'

describe('isReady', () => {
  it('true khi segment đã có bản dịch', () => {
    const seg: Segment = { id: 1, start: 0, end: 2, srcText: 'hello', viText: 'xin chào', status: 'ready' }
    expect(isReady(seg)).toBe(true)
  })

  it('false khi chưa dịch xong', () => {
    const seg: Segment = { id: 1, start: 0, end: 2, srcText: 'hello', status: 'pending' }
    expect(isReady(seg)).toBe(false)
  })

  it('false khi status là ready nhưng thiếu viText', () => {
    const seg: Segment = { id: 1, start: 0, end: 2, srcText: 'hello', status: 'ready' }
    expect(isReady(seg)).toBe(false)
  })
})
```

- [ ] **Step 6: Chạy test để xác nhận nó thất bại**

Run: `npm test`
Expected: FAIL — `Cannot find module './types'`

- [ ] **Step 7: Viết `src/core/types.ts`**

```ts
export interface Cue {
  /** Seconds from the start of the lecture. */
  start: number
  end: number
  text: string
}

export type SegmentStatus = 'pending' | 'translating' | 'ready' | 'failed'

export interface Segment {
  id: number
  start: number
  end: number
  /** Original English, as it came from the caption file. */
  srcText: string
  /** Vietnamese. Used for both the subtitle overlay and the spoken audio. */
  viText?: string
  status: SegmentStatus
}

/** A piece of speech that has been prepared but not yet played. */
export interface Utterance {
  /** Seconds the utterance takes at rate 1.0. Exact or estimated — see
   *  TTSProvider.knowsDurationAhead. */
  readonly duration: number
  /** Resolves when speech finishes. Rejects with AbortError if cancelled. */
  play(rate: number): Promise<void>
  cancel(): void
}

export interface TTSProvider {
  readonly name: string
  /** False for engines that can only estimate duration, such as Web Speech. */
  readonly knowsDurationAhead: boolean
  isAvailable(): Promise<boolean>
  prepare(text: string, signal: AbortSignal): Promise<Utterance>
}

/** The slice of HTMLVideoElement the scheduler touches, so tests can fake it. */
export interface VideoLike {
  currentTime: number
  playbackRate: number
  volume: number
  paused: boolean
}

export function isReady(segment: Segment): segment is Segment & { viText: string } {
  return segment.status === 'ready' && typeof segment.viText === 'string'
}
```

- [ ] **Step 8: Chạy test để xác nhận nó pass**

Run: `npm test`
Expected: PASS, 3 test

- [ ] **Step 9: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/
git commit -m "chore: scaffold the extension with WXT, TypeScript and Vitest"
```

---

### Task 2: Đọc file WebVTT

**Files:**
- Create: `extension/src/core/vtt.ts`
- Test: `extension/src/core/vtt.test.ts`

**Interfaces:**
- Consumes: `Cue` từ Task 1
- Produces: `parseVtt(text: string): Cue[]`

- [ ] **Step 1: Viết test thất bại**

File `src/core/vtt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseVtt } from './vtt'

describe('parseVtt', () => {
  it('đọc được cue cơ bản', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello and welcome
`
    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 3.5, text: 'Hello and welcome' }])
  })

  it('bỏ qua id của cue', () => {
    const vtt = `WEBVTT

42
00:00:05.000 --> 00:00:06.000
Second cue
`
    expect(parseVtt(vtt)).toEqual([{ start: 5, end: 6, text: 'Second cue' }])
  })

  it('gộp nhiều dòng text thành một chuỗi', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
first line
second line
`
    expect(parseVtt(vtt)[0].text).toBe('first line second line')
  })

  it('đọc được timestamp có giờ', () => {
    const vtt = `WEBVTT

01:02:03.250 --> 01:02:04.000
Late cue
`
    expect(parseVtt(vtt)[0].start).toBeCloseTo(3723.25)
  })

  it('bỏ thẻ định dạng trong text', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
<v Speaker>a <b>bold</b> word
`
    expect(parseVtt(vtt)[0].text).toBe('a bold word')
  })

  it('bỏ qua cue không có text', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000

00:00:01.000 --> 00:00:02.000
real text
`
    expect(parseVtt(vtt)).toHaveLength(1)
  })

  it('trả mảng rỗng cho chuỗi rỗng', () => {
    expect(parseVtt('')).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- vtt`
Expected: FAIL — `Cannot find module './vtt'`

- [ ] **Step 3: Viết `src/core/vtt.ts`**

```ts
import type { Cue } from './types'

const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

function stripTags(line: string): string {
  // Removes <v Name>, <b>, <00:00:01.000> and friends.
  return line.replace(/<[^>]*>/g, '')
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const timeIndex = lines.findIndex((l) => TIMESTAMP.test(l))
    if (timeIndex === -1) continue

    const match = TIMESTAMP.exec(lines[timeIndex])
    if (!match) continue

    const body = lines
      .slice(timeIndex + 1)
      .map((l) => stripTags(l).trim())
      .filter((l) => l !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (body === '') continue

    cues.push({
      start: toSeconds(match[1], match[2], match[3], match[4]),
      end: toSeconds(match[5], match[6], match[7], match[8]),
      text: body,
    })
  }

  return cues
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- vtt`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/vtt.ts extension/src/core/vtt.test.ts
git commit -m "feat: parse WebVTT caption files into cues"
```

---

### Task 3: Gộp cue vụn thành câu

Udemy cắt phụ đề ở mức 3–6 chữ. Dịch từng mẩu đó vừa sai ngữ nghĩa vừa cho ngữ điệu vụn. Task này gộp chúng lại thành câu hoàn chỉnh.

**Files:**
- Create: `extension/src/core/segmenter.ts`
- Test: `extension/src/core/segmenter.test.ts`

**Interfaces:**
- Consumes: `Cue`, `Segment` từ Task 1
- Produces: `mergeCues(cues: Cue[], opts?: MergeOptions): Segment[]`, `MergeOptions`

- [ ] **Step 1: Viết test thất bại**

File `src/core/segmenter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergeCues } from './segmenter'
import type { Cue } from './types'

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text })

describe('mergeCues', () => {
  it('gộp các mẩu cho tới khi gặp dấu kết câu', () => {
    const out = mergeCues([
      cue(0, 1, 'In this lesson'),
      cue(1, 2, 'we will build'),
      cue(2, 3, 'a React app.'),
      cue(3, 4, 'Let us start.'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].srcText).toBe('In this lesson we will build a React app.')
    expect(out[0].start).toBe(0)
    expect(out[0].end).toBe(3)
    expect(out[1].srcText).toBe('Let us start.')
  })

  it('cắt khi khoảng lặng vượt ngưỡng', () => {
    const out = mergeCues([cue(0, 1, 'first part'), cue(5, 6, 'second part')], {
      gapThreshold: 0.8,
    })
    expect(out).toHaveLength(2)
  })

  it('cắt khi vượt trần thời lượng dù chưa có dấu câu', () => {
    const cues = Array.from({ length: 20 }, (_, i) => cue(i, i + 1, `chunk ${i}`))
    const out = mergeCues(cues, { maxDuration: 12 })
    expect(out.length).toBeGreaterThan(1)
    for (const s of out) expect(s.end - s.start).toBeLessThanOrEqual(12)
  })

  it('đánh id tăng dần từ 0 và đặt status pending', () => {
    const out = mergeCues([cue(0, 1, 'one.'), cue(1, 2, 'two.')])
    expect(out.map((s) => s.id)).toEqual([0, 1])
    expect(out.every((s) => s.status === 'pending')).toBe(true)
  })

  it('coi dấu ? và ! là kết câu', () => {
    const out = mergeCues([cue(0, 1, 'Ready?'), cue(1, 2, 'Go!')])
    expect(out).toHaveLength(2)
  })

  it('không cắt ở dấu chấm của chữ viết tắt', () => {
    const out = mergeCues([cue(0, 1, 'the e.g. case'), cue(1, 2, 'continues here.')])
    expect(out).toHaveLength(1)
  })

  it('trả mảng rỗng cho đầu vào rỗng', () => {
    expect(mergeCues([])).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- segmenter`
Expected: FAIL — `Cannot find module './segmenter'`

- [ ] **Step 3: Viết `src/core/segmenter.ts`**

```ts
import type { Cue, Segment } from './types'

export interface MergeOptions {
  /** A silence longer than this ends the sentence, in seconds. */
  gapThreshold?: number
  /** Hard ceiling on one segment, in seconds. */
  maxDuration?: number
}

const DEFAULTS: Required<MergeOptions> = { gapThreshold: 0.8, maxDuration: 12 }

// A trailing period after one of these is an abbreviation, not a sentence end.
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|fig|no|approx)\.$/i

function endsSentence(text: string): boolean {
  const trimmed = text.trim()
  if (!/[.!?]["')\]]?$/.test(trimmed)) return false
  return !ABBREVIATIONS.test(trimmed)
}

export function mergeCues(cues: Cue[], opts: MergeOptions = {}): Segment[] {
  const { gapThreshold, maxDuration } = { ...DEFAULTS, ...opts }
  const segments: Segment[] = []

  let parts: string[] = []
  let start = 0
  let end = 0

  const flush = () => {
    if (parts.length === 0) return
    segments.push({
      id: segments.length,
      start,
      end,
      srcText: parts.join(' ').replace(/\s+/g, ' ').trim(),
      status: 'pending',
    })
    parts = []
  }

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]
    if (parts.length === 0) start = c.start
    parts.push(c.text)
    end = c.end

    const next = cues[i + 1]
    const gapTooBig = next !== undefined && next.start - c.end > gapThreshold
    const tooLong = next !== undefined && next.end - start > maxDuration

    if (endsSentence(c.text) || gapTooBig || tooLong || next === undefined) flush()
  }

  return segments
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- segmenter`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/segmenter.ts extension/src/core/segmenter.test.ts
git commit -m "feat: merge fragmentary caption cues into whole sentences"
```

---

### Task 4: Công thức co giãn

Đây là trái tim của phần đồng bộ, và nó thuần túy nên test được trọn vẹn. Công thức lấy nguyên từ spec mục 6.2.

**Files:**
- Create: `extension/src/core/rate.ts`
- Test: `extension/src/core/rate.test.ts`

**Interfaces:**
- Consumes: không có
- Produces: `computeStretch(input: StretchInput): StretchPlan`, `StretchInput`, `StretchPlan`

- [ ] **Step 1: Viết test thất bại**

File `src/core/rate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeStretch } from './rate'

describe('computeStretch', () => {
  it('không co giãn gì khi bản dịch vừa khung thời gian', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 4, baseline: 1,
    })
    expect(plan.ttsRate).toBe(1)
    expect(plan.videoRate).toBe(1)
  })

  it('tăng tốc đọc khi bản dịch dài hơn khung', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 6, baseline: 1,
    })
    expect(plan.ttsRate).toBeCloseTo(1.2)
    expect(plan.videoRate).toBe(1)
  })

  it('kẹp tốc độ đọc ở 1.4 và làm chậm video khi vẫn chưa đủ', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 10, baseline: 1,
    })
    expect(plan.ttsRate).toBe(1.4)
    expect(plan.videoRate).toBeLessThan(1)
    expect(plan.videoRate).toBeGreaterThanOrEqual(0.85)
  })

  it('không bao giờ hạ video xuống dưới 85% tốc độ người dùng chọn', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 100, baseline: 1,
    })
    expect(plan.videoRate).toBeCloseTo(0.85)
  })

  it('sàn làm chậm là tương đối theo baseline, không phải tuyệt đối', () => {
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 0, duration: 100, baseline: 1.5,
    })
    // 0.85 * 1.5, chứ không phải 0.85
    expect(plan.videoRate).toBeCloseTo(1.275)
  })

  it('người xem ở 1.5x có ngân sách thời gian thực co lại 1.5 lần', () => {
    // Khung 6 giây video, ở 1.5x chỉ còn 4 giây thực. Bản dịch 4 giây vừa khít.
    const plan = computeStretch({
      segmentStart: 0, segmentEnd: 6, gapAfter: 0, duration: 4, baseline: 1.5,
    })
    expect(plan.ttsRate).toBeCloseTo(1)
    expect(plan.videoRate).toBeCloseTo(1.5)
  })

  it('tính cả khoảng lặng sau segment vào ngân sách', () => {
    const withGap = computeStretch({
      segmentStart: 0, segmentEnd: 5, gapAfter: 2, duration: 6, baseline: 1,
    })
    expect(withGap.ttsRate).toBe(1)
  })

  it('không chia cho 0 khi khung thời gian bằng 0', () => {
    const plan = computeStretch({
      segmentStart: 3, segmentEnd: 3, gapAfter: 0, duration: 2, baseline: 1,
    })
    expect(Number.isFinite(plan.ttsRate)).toBe(true)
    expect(Number.isFinite(plan.videoRate)).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- rate`
Expected: FAIL — `Cannot find module './rate'`

- [ ] **Step 3: Viết `src/core/rate.ts`**

```ts
export const MIN_TTS_RATE = 1.0
export const MAX_TTS_RATE = 1.4
/** Floor on video slowdown, relative to the speed the viewer chose. */
export const VIDEO_SLOWDOWN_FLOOR = 0.85

export interface StretchInput {
  segmentStart: number
  segmentEnd: number
  /** Silence before the next segment starts, in video-time seconds. */
  gapAfter: number
  /** Seconds the utterance takes at rate 1.0. */
  duration: number
  /** The playback speed the viewer chose. Not 1.0 by default. */
  baseline: number
}

export interface StretchPlan {
  ttsRate: number
  videoRate: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function computeStretch(input: StretchInput): StretchPlan {
  const { segmentStart, segmentEnd, gapAfter, duration, baseline } = input

  // W is measured in video time; haveWall converts it to real seconds.
  const W = Math.max(0, segmentEnd - segmentStart) + Math.max(0, gapAfter)
  const haveWall = W / baseline

  if (haveWall <= 0 || duration <= 0) {
    return { ttsRate: MAX_TTS_RATE, videoRate: baseline }
  }

  const ttsRate = clamp(duration / haveWall, MIN_TTS_RATE, MAX_TTS_RATE)
  const needWall = duration / ttsRate

  const videoRate =
    needWall > haveWall
      ? Math.max(VIDEO_SLOWDOWN_FLOOR * baseline, W / needWall)
      : baseline

  return { ttsRate, videoRate }
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- rate`
Expected: PASS, 8 test

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/rate.ts extension/src/core/rate.test.ts
git commit -m "feat: compute TTS and video rates to fit a translation in its slot"
```

---

### Task 5: Chia lô dịch, ưu tiên lô đang xem

**Files:**
- Create: `extension/src/core/batching.ts`
- Test: `extension/src/core/batching.test.ts`

**Interfaces:**
- Consumes: `Segment` từ Task 1
- Produces: `planBatches(segments: Segment[], currentTime: number, batchSize?: number): Segment[][]`

- [ ] **Step 1: Viết test thất bại**

File `src/core/batching.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planBatches } from './batching'
import type { Segment } from './types'

const make = (n: number): Segment[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i, start: i * 5, end: i * 5 + 5, srcText: `line ${i}`, status: 'pending' as const,
  }))

describe('planBatches', () => {
  it('chia đúng kích thước lô', () => {
    const batches = planBatches(make(100), 0, 40)
    expect(batches.map((b) => b.length)).toEqual([40, 40, 20])
  })

  it('đặt lô chứa vị trí đang xem lên đầu', () => {
    // currentTime 220s rơi vào segment 44, tức lô thứ hai
    const batches = planBatches(make(100), 220, 40)
    expect(batches[0][0].id).toBe(40)
  })

  it('các lô còn lại giữ thứ tự phát', () => {
    const batches = planBatches(make(100), 220, 40)
    expect(batches.slice(1).map((b) => b[0].id)).toEqual([0, 80])
  })

  it('bỏ qua segment đã dịch xong', () => {
    const segs = make(10)
    segs[0].status = 'ready'
    segs[0].viText = 'đã dịch'
    const batches = planBatches(segs, 0, 40)
    expect(batches[0].every((s) => s.status !== 'ready')).toBe(true)
    expect(batches[0]).toHaveLength(9)
  })

  it('trả mảng rỗng khi mọi segment đã dịch', () => {
    const segs = make(3).map((s) => ({ ...s, status: 'ready' as const, viText: 'x' }))
    expect(planBatches(segs, 0, 40)).toEqual([])
  })

  it('currentTime vượt quá bài giảng thì vẫn trả đủ lô', () => {
    const batches = planBatches(make(10), 99999, 40)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(10)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- batching`
Expected: FAIL — `Cannot find module './batching'`

- [ ] **Step 3: Viết `src/core/batching.ts`**

```ts
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
  for (let i = 0; i < pending.length; i += batchSize) {
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- batching`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/batching.ts extension/src/core/batching.test.ts
git commit -m "feat: batch segments for translation, current batch first"
```

---

### Task 6: Prompt dịch và kiểm tra kết quả

LLM trả về sai hoặc thiếu id là chuyện xảy ra thật khi dịch theo lô (spec mục 10). Task này vừa dựng prompt vừa dựng lớp kiểm tra.

**Files:**
- Create: `extension/src/core/translate/prompt.ts`, `extension/src/core/translate/validate.ts`
- Test: `extension/src/core/translate/prompt.test.ts`, `extension/src/core/translate/validate.test.ts`

**Interfaces:**
- Consumes: `Segment` từ Task 1
- Produces: `buildPrompt(batch: Segment[]): string`, `matchTranslations(batch: Segment[], raw: string): MatchResult`, `MatchResult`

- [ ] **Step 1: Viết test thất bại cho prompt**

File `src/core/translate/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildPrompt } from './prompt'
import type { Segment } from '../types'

const batch: Segment[] = [
  { id: 7, start: 0, end: 3, srcText: 'today we implement a project react', status: 'pending' },
  { id: 8, start: 3, end: 5, srcText: 'with backend fastapi', status: 'pending' },
]

describe('buildPrompt', () => {
  it('liệt kê từng câu kèm id', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('"id": 7')
    expect(p).toContain('today we implement a project react')
  })

  it('yêu cầu giữ nguyên thuật ngữ IT bằng tiếng Anh', () => {
    const p = buildPrompt(batch)
    expect(p.toLowerCase()).toContain('english')
  })

  it('nêu ví dụ chuẩn của spec', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('project React')
    expect(p).toContain('FastAPI')
  })

  it('yêu cầu dịch gọn theo thời lượng', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('15%')
  })

  it('yêu cầu trả JSON thuần', () => {
    const p = buildPrompt(batch)
    expect(p).toContain('JSON')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- prompt`
Expected: FAIL — `Cannot find module './prompt'`

- [ ] **Step 3: Viết `src/core/translate/prompt.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test prompt để xác nhận pass**

Run: `npm test -- prompt`
Expected: PASS, 5 test

- [ ] **Step 5: Viết test thất bại cho validate**

File `src/core/translate/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchTranslations } from './validate'
import type { Segment } from '../types'

const batch: Segment[] = [
  { id: 1, start: 0, end: 2, srcText: 'a', status: 'pending' },
  { id: 2, start: 2, end: 4, srcText: 'b', status: 'pending' },
]

describe('matchTranslations', () => {
  it('khớp id với bản dịch', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"một"},{"id":2,"vi":"hai"}]')
    expect(r.matched.get(1)).toBe('một')
    expect(r.missing).toEqual([])
  })

  it('bóc được JSON nằm trong hàng rào markdown', () => {
    const raw = '```json\n[{"id":1,"vi":"một"},{"id":2,"vi":"hai"}]\n```'
    expect(matchTranslations(batch, raw).matched.size).toBe(2)
  })

  it('báo id thiếu thay vì im lặng', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"một"}]')
    expect(r.missing).toEqual([2])
  })

  it('bỏ qua id không thuộc lô', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"một"},{"id":99,"vi":"lạc"}]')
    expect(r.matched.has(99)).toBe(false)
    expect(r.missing).toEqual([2])
  })

  it('bỏ qua bản dịch rỗng và coi là thiếu', () => {
    const r = matchTranslations(batch, '[{"id":1,"vi":"   "},{"id":2,"vi":"hai"}]')
    expect(r.missing).toEqual([1])
  })

  it('JSON hỏng thì coi như thiếu tất cả, không ném lỗi', () => {
    const r = matchTranslations(batch, 'not json at all')
    expect(r.matched.size).toBe(0)
    expect(r.missing).toEqual([1, 2])
  })
})
```

- [ ] **Step 6: Chạy test để xác nhận thất bại**

Run: `npm test -- validate`
Expected: FAIL — `Cannot find module './validate'`

- [ ] **Step 7: Viết `src/core/translate/validate.ts`**

```ts
import type { Segment } from '../types'

export interface MatchResult {
  matched: Map<number, string>
  /** Ids the model failed to return usefully. These go back in the queue. */
  missing: number[]
}

function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const body = (fenced ? fenced[1] : raw).trim()
  try {
    return JSON.parse(body)
  } catch {
    // Fall back to the outermost array, in case the model added prose.
    const start = body.indexOf('[')
    const end = body.lastIndexOf(']')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(body.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export function matchTranslations(batch: Segment[], raw: string): MatchResult {
  const wanted = new Set(batch.map((s) => s.id))
  const matched = new Map<number, string>()
  const parsed = extractJson(raw)

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const { id, vi } = entry as { id?: unknown; vi?: unknown }
      if (typeof id !== 'number' || !wanted.has(id)) continue
      if (typeof vi !== 'string' || vi.trim() === '') continue
      matched.set(id, vi.trim())
    }
  }

  return { matched, missing: batch.map((s) => s.id).filter((id) => !matched.has(id)) }
}
```

- [ ] **Step 8: Chạy test để xác nhận pass**

Run: `npm test -- validate`
Expected: PASS, 6 test

- [ ] **Step 9: Commit**

```bash
git add extension/src/core/translate/
git commit -m "feat: build translation prompts and validate batched responses"
```

---

### Task 7: Ước lượng thời lượng cho Web Speech

Web Speech không báo trước độ dài, nên phải ước lượng rồi tự hiệu chỉnh. VieNeu ở M2 sẽ không cần lớp này — nó báo chính xác.

**Files:**
- Create: `extension/src/core/duration-estimator.ts`
- Test: `extension/src/core/duration-estimator.test.ts`

**Interfaces:**
- Consumes: không có
- Produces: `DurationEstimator` với `estimate(text)`, `observe(text, actualSeconds)`, `charsPerSecond`

- [ ] **Step 1: Viết test thất bại**

File `src/core/duration-estimator.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DurationEstimator } from './duration-estimator'

describe('DurationEstimator', () => {
  it('ước lượng theo số ký tự và hệ số ban đầu', () => {
    const e = new DurationEstimator(15)
    expect(e.estimate('x'.repeat(30))).toBeCloseTo(2)
  })

  it('hội tụ về tốc độ thật sau vài lần quan sát', () => {
    const e = new DurationEstimator(15)
    const text = 'x'.repeat(100)
    for (let i = 0; i < 20; i++) e.observe(text, 10) // thực tế 10 ch/s
    expect(e.charsPerSecond).toBeGreaterThan(10)
    expect(e.charsPerSecond).toBeLessThan(11)
  })

  it('bỏ qua quan sát vô lý thay vì để nó phá hệ số', () => {
    const e = new DurationEstimator(15)
    const before = e.charsPerSecond
    e.observe('hello', 0)
    e.observe('', 5)
    e.observe('hello', -3)
    expect(e.charsPerSecond).toBe(before)
  })

  it('không bao giờ trả thời lượng bằng 0', () => {
    const e = new DurationEstimator(15)
    expect(e.estimate('')).toBeGreaterThan(0)
  })

  it('giữ hệ số trong khoảng hợp lý', () => {
    const e = new DurationEstimator(15)
    for (let i = 0; i < 50; i++) e.observe('x'.repeat(100), 0.01)
    expect(e.charsPerSecond).toBeLessThanOrEqual(40)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- duration-estimator`
Expected: FAIL — `Cannot find module './duration-estimator'`

- [ ] **Step 3: Viết `src/core/duration-estimator.ts`**

```ts
const MIN_CPS = 5
const MAX_CPS = 40
/** Weight of each new observation in the moving average. */
const ALPHA = 0.2
const MIN_DURATION = 0.15

/**
 * Web Speech cannot report how long an utterance will take, so the scheduler
 * estimates it from character count and corrects the rate after each sentence.
 * A few sentences are enough to converge on the viewer's voice and machine.
 */
export class DurationEstimator {
  private cps: number

  constructor(initialCharsPerSecond = 15) {
    this.cps = initialCharsPerSecond
  }

  get charsPerSecond(): number {
    return this.cps
  }

  estimate(text: string): number {
    return Math.max(MIN_DURATION, text.length / this.cps)
  }

  observe(text: string, actualSeconds: number): void {
    if (text.length === 0 || actualSeconds <= 0) return
    const observed = text.length / actualSeconds
    if (!Number.isFinite(observed)) return
    const blended = this.cps * (1 - ALPHA) + observed * ALPHA
    this.cps = Math.min(MAX_CPS, Math.max(MIN_CPS, blended))
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- duration-estimator`
Expected: PASS, 5 test

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/duration-estimator.ts extension/src/core/duration-estimator.test.ts
git commit -m "feat: estimate Web Speech utterance length and self-correct"
```

---

### Task 8: Scheduler

Phần khó nhất, và nhờ các task trước đã tách sạch nên test được toàn bộ bằng đồng hồ ảo, video giả và provider giả — không cần trình duyệt, không cần loa.

**Files:**
- Create: `extension/src/core/scheduler.ts`
- Create: `extension/src/core/testing/fakes.ts`
- Test: `extension/src/core/scheduler.test.ts`

**Interfaces:**
- Consumes: `Segment`, `VideoLike`, `TTSProvider`, `Utterance` (Task 1); `computeStretch` (Task 4)
- Produces: `Scheduler` với `tick()`, `setSegments()`, `stop()`, `onSeek()`; `FakeVideo`, `FakeTTS` cho test

- [ ] **Step 1: Viết provider giả và video giả**

File `src/core/testing/fakes.ts`:

```ts
import type { TTSProvider, Utterance, VideoLike } from '../types'

export class FakeVideo implements VideoLike {
  currentTime = 0
  playbackRate = 1
  volume = 1
  paused = false
}

export class FakeUtterance implements Utterance {
  played = false
  cancelled = false
  rateUsed: number | null = null
  private resolve: (() => void) | null = null

  constructor(readonly duration: number) {}

  play(rate: number): Promise<void> {
    this.played = true
    this.rateUsed = rate
    return new Promise<void>((res) => {
      this.resolve = res
    })
  }

  /** Test helper: end the utterance as if speech finished. */
  finish(): void {
    this.resolve?.()
    this.resolve = null
  }

  cancel(): void {
    this.cancelled = true
    this.resolve?.()
    this.resolve = null
  }
}

export class FakeTTS implements TTSProvider {
  readonly name = 'fake'
  readonly knowsDurationAhead = true
  readonly prepared: FakeUtterance[] = []

  /** Seconds of speech to report for any text. */
  constructor(private durationFor: (text: string) => number = () => 1) {}

  async isAvailable(): Promise<boolean> {
    return true
  }

  async prepare(text: string): Promise<Utterance> {
    const u = new FakeUtterance(this.durationFor(text))
    this.prepared.push(u)
    return u
  }

  get last(): FakeUtterance | undefined {
    return this.prepared[this.prepared.length - 1]
  }
}
```

- [ ] **Step 2: Viết test thất bại cho scheduler**

File `src/core/scheduler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { Scheduler } from './scheduler'
import { FakeTTS, FakeVideo } from './testing/fakes'
import type { Segment } from './types'

const segs = (): Segment[] => [
  { id: 0, start: 1, end: 5, srcText: 'a', viText: 'câu một', status: 'ready' },
  { id: 1, start: 6, end: 10, srcText: 'b', viText: 'câu hai', status: 'ready' },
]

function setup(durationFor: (t: string) => number = () => 2) {
  const video = new FakeVideo()
  const tts = new FakeTTS(durationFor)
  const scheduler = new Scheduler({ video, provider: tts, duckVolume: 0.1 })
  scheduler.setSegments(segs())
  return { video, tts, scheduler }
}

describe('Scheduler', () => {
  it('chưa đọc gì khi video chưa tới segment đầu', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
  })

  it('bắt đầu đọc khi video chạm start của segment', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.last?.played).toBe(true)
  })

  it('hạ âm lượng gốc khi đang đọc và trả lại khi xong', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(video.volume).toBeCloseTo(0.1)
    tts.last!.finish()
    await vi.waitFor(() => expect(video.volume).toBeCloseTo(1))
  })

  it('không đọc lại segment đã đọc', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    tts.last!.finish()
    await vi.waitFor(() => expect(video.volume).toBeCloseTo(1))
    video.currentTime = 2.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(1)
  })

  it('làm chậm video khi bản dịch dài hơn khung, rồi khôi phục', async () => {
    const { video, tts, scheduler } = setup(() => 20)
    video.currentTime = 1.0
    await scheduler.tick()
    expect(video.playbackRate).toBeLessThan(1)
    tts.last!.finish()
    await vi.waitFor(() => expect(video.playbackRate).toBeCloseTo(1))
  })

  it('dùng tốc độ người dùng chọn làm baseline', async () => {
    const { video, tts, scheduler } = setup(() => 2)
    video.playbackRate = 1.5
    scheduler.setBaseline(1.5)
    video.currentTime = 1.0
    await scheduler.tick()
    // Khung 5 giây video (4 giây segment + 1 giây lặng) ở 1.5x còn 3.33 giây
    // thực; bản đọc 2 giây thừa chỗ nên không phải co giãn gì
    expect(tts.last?.rateUsed).toBeCloseTo(1)
    expect(video.playbackRate).toBeCloseTo(1.5)
  })

  it('tua thì huỷ câu đang đọc và khôi phục âm lượng', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    scheduler.onSeek()
    expect(tts.last?.cancelled).toBe(true)
    expect(video.volume).toBeCloseTo(1)
  })

  it('sau khi tua lùi thì đọc lại segment đó', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()
    scheduler.onSeek()
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(2)
  })

  it('bỏ qua segment chưa dịch xong và không hạ âm lượng', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.setSegments([
      { id: 0, start: 1, end: 5, srcText: 'a', status: 'pending' },
    ])
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
  })

  it('video đang tạm dừng thì không bắt đầu câu mới', async () => {
    const { video, tts, scheduler } = setup()
    video.paused = true
    video.currentTime = 1.0
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
  })

  it('bỏ qua segment đã trôi quá xa thay vì đọc đuổi', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 4.0 // vào segment 0 đã 3 giây, quá ngưỡng 1.5
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
  })

  it('vẫn đọc khi chỉ trễ trong ngưỡng cho phép', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 2.0 // trễ 1 giây, dưới ngưỡng
    await scheduler.tick()
    expect(tts.last?.played).toBe(true)
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npm test -- scheduler`
Expected: FAIL — `Cannot find module './scheduler'`

- [ ] **Step 4: Viết `src/core/scheduler.ts`**

```ts
import { computeStretch } from './rate'
import { isReady, type Segment, type TTSProvider, type Utterance, type VideoLike } from './types'

export interface SchedulerOptions {
  video: VideoLike
  provider: TTSProvider
  /** Original audio level while the dub is speaking. */
  duckVolume?: number
}

/** A segment whose start is further behind than this is skipped, not chased. */
const MAX_LATENESS = 1.5

export class Scheduler {
  private readonly video: VideoLike
  private readonly provider: TTSProvider
  private readonly duckVolume: number

  private segments: Segment[] = []
  private spoken = new Set<number>()
  private baseline = 1
  private originalVolume = 1

  private speaking: { utterance: Utterance; controller: AbortController } | null = null

  constructor(opts: SchedulerOptions) {
    this.video = opts.video
    this.provider = opts.provider
    this.duckVolume = opts.duckVolume ?? 0.1
  }

  setSegments(segments: Segment[]): void {
    this.segments = segments
  }

  /** Records the speed the viewer chose. All stretching is relative to it. */
  setBaseline(rate: number): void {
    this.baseline = rate > 0 ? rate : 1
  }

  onSeek(): void {
    this.cancelCurrent()
    // Anything after the new position may be spoken again.
    this.spoken.clear()
  }

  stop(): void {
    this.cancelCurrent()
  }

  /** Drives one frame. The content script calls this from requestAnimationFrame. */
  async tick(): Promise<void> {
    if (this.speaking !== null || this.video.paused) return

    const now = this.video.currentTime
    const index = this.segments.findIndex(
      (s) => !this.spoken.has(s.id) && now >= s.start && now < s.end,
    )
    if (index === -1) return

    const segment = this.segments[index]
    if (now - segment.start > MAX_LATENESS) {
      this.spoken.add(segment.id)
      return
    }
    if (!isReady(segment)) {
      // Not translated yet: let the original audio play at full volume.
      this.spoken.add(segment.id)
      return
    }

    this.spoken.add(segment.id)
    await this.speak(segment, this.segments[index + 1])
  }

  private async speak(segment: Segment & { viText: string }, next: Segment | undefined): Promise<void> {
    const controller = new AbortController()
    let utterance: Utterance
    try {
      utterance = await this.provider.prepare(segment.viText, controller.signal)
    } catch {
      return
    }

    const plan = computeStretch({
      segmentStart: segment.start,
      segmentEnd: segment.end,
      gapAfter: next ? Math.max(0, next.start - segment.end) : 0,
      duration: utterance.duration,
      baseline: this.baseline,
    })

    this.speaking = { utterance, controller }
    this.originalVolume = this.video.volume
    this.video.volume = this.duckVolume
    this.video.playbackRate = plan.videoRate

    // Start speaking but do not await it: tick() has to return so the next
    // frame can run. The `speaking` guard is what prevents overlap.
    void utterance
      .play(plan.ttsRate)
      .catch(() => {
        // Cancelled mid-sentence; restoring below is still correct.
      })
      .finally(() => {
        if (this.speaking?.utterance === utterance) this.restore()
      })
  }

  private restore(): void {
    this.speaking = null
    this.video.volume = this.originalVolume
    this.video.playbackRate = this.baseline
  }

  private cancelCurrent(): void {
    if (this.speaking === null) return
    this.speaking.controller.abort()
    this.speaking.utterance.cancel()
    this.restore()
  }
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `npm test -- scheduler`
Expected: PASS, 12 test

- [ ] **Step 6: Commit**

```bash
git add extension/src/core/scheduler.ts extension/src/core/testing/ extension/src/core/scheduler.test.ts
git commit -m "feat: schedule dubbed speech against the video timeline"
```

---

### Task 9: WebSpeechProvider

**Files:**
- Create: `extension/src/providers/web-speech.ts`
- Test: `extension/src/providers/web-speech.test.ts`

**Interfaces:**
- Consumes: `TTSProvider`, `Utterance` (Task 1); `DurationEstimator` (Task 7)
- Produces: `WebSpeechProvider` implements `TTSProvider`

- [ ] **Step 1: Viết test thất bại**

File `src/providers/web-speech.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSpeechProvider } from './web-speech'

class FakeSpeechSynthesisUtterance {
  text = ''
  lang = ''
  rate = 1
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

function installFakeSpeech() {
  const spoken: FakeSpeechSynthesisUtterance[] = []
  const synth = {
    speak: vi.fn((u: FakeSpeechSynthesisUtterance) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: () => [{ lang: 'vi-VN', name: 'Linh', default: true }],
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
  return { synth, spoken }
}

describe('WebSpeechProvider', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('báo là không biết trước thời lượng', () => {
    installFakeSpeech()
    expect(new WebSpeechProvider().knowsDurationAhead).toBe(false)
  })

  it('khả dụng khi có giọng vi-VN', async () => {
    installFakeSpeech()
    expect(await new WebSpeechProvider().isAvailable()).toBe(true)
  })

  it('ước lượng thời lượng theo độ dài văn bản', async () => {
    installFakeSpeech()
    const p = new WebSpeechProvider()
    const short = await p.prepare('ngắn', new AbortController().signal)
    const long = await p.prepare('x'.repeat(200), new AbortController().signal)
    expect(long.duration).toBeGreaterThan(short.duration)
  })

  it('truyền tốc độ đọc xuống SpeechSynthesisUtterance', async () => {
    const { spoken } = installFakeSpeech()
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    void u.play(1.25)
    expect(spoken[0].rate).toBeCloseTo(1.25)
  })

  it('play resolve khi onend được gọi', async () => {
    const { spoken } = installFakeSpeech()
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    const done = u.play(1)
    spoken[0].onend?.()
    await expect(done).resolves.toBeUndefined()
  })

  it('cancel gọi speechSynthesis.cancel', async () => {
    const { synth } = installFakeSpeech()
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    void u.play(1)
    u.cancel()
    expect(synth.cancel).toHaveBeenCalled()
  })

  it('hiệu chỉnh ước lượng sau khi đọc xong', async () => {
    const { spoken } = installFakeSpeech()
    const p = new WebSpeechProvider()
    const before = p.charsPerSecond
    const u = await p.prepare('x'.repeat(100), new AbortController().signal)
    const done = u.play(1)
    spoken[0].onend?.()
    await done
    expect(p.charsPerSecond).not.toBe(before)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- web-speech`
Expected: FAIL — `Cannot find module './web-speech'`

- [ ] **Step 3: Viết `src/providers/web-speech.ts`**

```ts
import { DurationEstimator } from '../core/duration-estimator'
import type { TTSProvider, Utterance } from '../core/types'

const LANG = 'vi-VN'

/**
 * Speaks through the browser's built-in synthesiser. Used as the fallback, and
 * as the only engine in M1 so the sync machinery can be validated before the
 * local TTS server exists.
 *
 * On macOS this reaches exactly one Vietnamese voice ("Linh"); the Enhanced
 * build Apple ships is not exposed to the Web Speech API.
 */
export class WebSpeechProvider implements TTSProvider {
  readonly name = 'web-speech'
  readonly knowsDurationAhead = false

  private readonly estimator = new DurationEstimator(15)

  get charsPerSecond(): number {
    return this.estimator.charsPerSecond
  }

  async isAvailable(): Promise<boolean> {
    if (typeof speechSynthesis === 'undefined') return false
    return this.voice() !== undefined
  }

  private voice(): SpeechSynthesisVoice | undefined {
    return speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('vi'))
  }

  async prepare(text: string, signal: AbortSignal): Promise<Utterance> {
    const estimator = this.estimator
    const voice = this.voice()
    const duration = estimator.estimate(text)

    let native: SpeechSynthesisUtterance | null = null
    let startedAt = 0

    return {
      duration,

      play(rate: number): Promise<void> {
        if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
        return new Promise<void>((resolve, reject) => {
          const u = new SpeechSynthesisUtterance(text)
          u.lang = LANG
          u.rate = rate
          if (voice) u.voice = voice
          native = u
          startedAt = Date.now()

          u.onend = () => {
            // Normalise back to rate 1.0 before feeding the estimator.
            estimator.observe(text, ((Date.now() - startedAt) / 1000) * rate)
            resolve()
          }
          u.onerror = () => reject(new Error('speech synthesis failed'))

          speechSynthesis.speak(u)
        })
      },

      cancel(): void {
        if (native !== null) speechSynthesis.cancel()
      },
    }
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- web-speech`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add extension/src/providers/
git commit -m "feat: add the Web Speech TTS provider with self-correcting estimates"
```

---

### Task 10: player-bridge

**Files:**
- Create: `extension/src/player/player-bridge.ts`
- Test: `extension/src/player/player-bridge.test.ts`
- Modify: `extension/vitest.config.ts` (thêm môi trường jsdom cho thư mục này)

**Interfaces:**
- Consumes: không có
- Produces: `lectureIdFromUrl(url: string): string | null`, `createPlayerBridge(doc: Document): PlayerBridge`, `PlayerBridge`

- [ ] **Step 1: Cài jsdom và bật cho các test cần DOM**

```bash
cd /Users/anhdh/dubbing/extension
npm install --save-dev jsdom
```

Sửa `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['src/player/**', 'jsdom'], ['src/entrypoints/**', 'jsdom']],
  },
})
```

- [ ] **Step 2: Viết test thất bại**

File `src/player/player-bridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createPlayerBridge, lectureIdFromUrl } from './player-bridge'

describe('lectureIdFromUrl', () => {
  it('lấy được id bài giảng', () => {
    expect(lectureIdFromUrl('https://www.udemy.com/course/react-basics/learn/lecture/12345678')).toBe('12345678')
  })

  it('bỏ qua query string', () => {
    expect(lectureIdFromUrl('https://www.udemy.com/course/x/learn/lecture/999?start=0')).toBe('999')
  })

  it('trả null cho URL không phải trang bài giảng', () => {
    expect(lectureIdFromUrl('https://www.udemy.com/')).toBeNull()
  })
})

describe('createPlayerBridge', () => {
  it('báo attached khi video xuất hiện', async () => {
    const onAttached = vi.fn()
    const bridge = createPlayerBridge(document)
    bridge.on('attached', onAttached)
    bridge.start()

    const video = document.createElement('video')
    document.body.appendChild(video)

    await vi.waitFor(() => expect(onAttached).toHaveBeenCalledWith(video))
    bridge.stop()
  })

  it('chuyển tiếp sự kiện seeked', async () => {
    const onSeek = vi.fn()
    const video = document.createElement('video')
    document.body.appendChild(video)

    const bridge = createPlayerBridge(document)
    bridge.on('seeked', onSeek)
    bridge.start()
    await vi.waitFor(() => expect(bridge.video).toBe(video))

    video.dispatchEvent(new Event('seeked'))
    expect(onSeek).toHaveBeenCalled()
    bridge.stop()
  })

  it('chuyển tiếp ratechange kèm tốc độ mới', async () => {
    const onRate = vi.fn()
    const video = document.createElement('video')
    document.body.appendChild(video)

    const bridge = createPlayerBridge(document)
    bridge.on('ratechange', onRate)
    bridge.start()
    await vi.waitFor(() => expect(bridge.video).toBe(video))

    video.playbackRate = 1.5
    video.dispatchEvent(new Event('ratechange'))
    expect(onRate).toHaveBeenCalledWith(1.5)
    bridge.stop()
  })
})
```

Lưu ý: xoá `document.body.innerHTML` giữa các test bằng `beforeEach(() => { document.body.innerHTML = '' })`.

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npm test -- player-bridge`
Expected: FAIL — `Cannot find module './player-bridge'`

- [ ] **Step 4: Viết `src/player/player-bridge.ts`**

```ts
const LECTURE_URL = /\/learn\/lecture\/(\d+)/

export function lectureIdFromUrl(url: string): string | null {
  return LECTURE_URL.exec(url)?.[1] ?? null
}

export interface PlayerBridgeEvents {
  attached: (video: HTMLVideoElement) => void
  detached: () => void
  lectureChanged: (lectureId: string) => void
  seeked: () => void
  ratechange: (rate: number) => void
}

type Handlers = { [K in keyof PlayerBridgeEvents]?: PlayerBridgeEvents[K][] }

export interface PlayerBridge {
  readonly video: HTMLVideoElement | null
  on<K extends keyof PlayerBridgeEvents>(event: K, fn: PlayerBridgeEvents[K]): void
  start(): void
  stop(): void
}

/**
 * Udemy is a single page app: navigating to the next lecture swaps the video
 * element without a page load, so the bridge watches the DOM and the URL
 * rather than relying on load events.
 */
export function createPlayerBridge(doc: Document): PlayerBridge {
  const handlers: Handlers = {}
  let video: HTMLVideoElement | null = null
  let lectureId: string | null = null
  let observer: MutationObserver | null = null

  const emit = <K extends keyof PlayerBridgeEvents>(
    event: K,
    ...args: Parameters<PlayerBridgeEvents[K]>
  ) => {
    for (const fn of handlers[event] ?? []) (fn as (...a: unknown[]) => void)(...args)
  }

  const onSeeked = () => emit('seeked')
  const onRateChange = () => {
    if (video) emit('ratechange', video.playbackRate)
  }

  const detach = () => {
    if (!video) return
    video.removeEventListener('seeked', onSeeked)
    video.removeEventListener('ratechange', onRateChange)
    video = null
    emit('detached')
  }

  const scan = () => {
    const url = doc.defaultView?.location.href ?? ''
    const id = lectureIdFromUrl(url)
    if (id !== null && id !== lectureId) {
      lectureId = id
      emit('lectureChanged', id)
    }

    const found = doc.querySelector('video')
    if (found === video) return
    detach()
    if (found === null) return

    video = found
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('ratechange', onRateChange)
    emit('attached', video)
  }

  return {
    get video() {
      return video
    },
    on(event, fn) {
      ;(handlers[event] ??= [] as never).push(fn as never)
    },
    start() {
      observer = new MutationObserver(scan)
      observer.observe(doc.documentElement, { childList: true, subtree: true })
      scan()
    },
    stop() {
      observer?.disconnect()
      observer = null
      detach()
    },
  }
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `npm test -- player-bridge`
Expected: PASS, 6 test

- [ ] **Step 6: Commit**

```bash
git add extension/src/player/ extension/vitest.config.ts extension/package.json
git commit -m "feat: track Udemy's video element and lecture changes across SPA navigation"
```

---

### Task 11: caption-source

Spec mục 4.5: bắt request `.vtt` mà Udemy gọi, dự phòng bằng `textTracks`. MV3 không cho `webRequest` đọc response body, nên phải vá `fetch`/`XHR` ở MAIN world.

**Files:**
- Create: `extension/src/player/caption-hook.ts` (logic vá, thuần túy để test)
- Create: `extension/src/entrypoints/caption-hook.content.ts` (đăng ký ở MAIN world)
- Create: `extension/src/player/caption-source.ts` (nhận URL, dự phòng textTracks)
- Test: `extension/src/player/caption-hook.test.ts`, `extension/src/player/caption-source.test.ts`

**Interfaces:**
- Consumes: `Cue` (Task 1), `parseVtt` (Task 2)
- Produces: `installCaptionHook(win: WindowLike, onUrl: (url: string) => void): () => void`, `cuesFromTextTracks(video: HTMLVideoElement): Cue[]`, `CAPTION_MESSAGE`

- [ ] **Step 1: Viết test thất bại cho hook**

File `src/player/caption-hook.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { installCaptionHook, type WindowLike } from './caption-hook'

function fakeWindow(): WindowLike {
  return { fetch: vi.fn(async () => new Response('ok')) } as unknown as WindowLike
}

describe('installCaptionHook', () => {
  it('báo URL khi trang fetch một file .vtt', async () => {
    const win = fakeWindow()
    const seen: string[] = []
    installCaptionHook(win, (u) => seen.push(u))
    await win.fetch('https://x.udemycdn.com/caption/en_US.vtt')
    expect(seen).toEqual(['https://x.udemycdn.com/caption/en_US.vtt'])
  })

  it('bỏ qua request không phải phụ đề', async () => {
    const win = fakeWindow()
    const seen: string[] = []
    installCaptionHook(win, (u) => seen.push(u))
    await win.fetch('https://www.udemy.com/api-2.0/users/me/')
    expect(seen).toEqual([])
  })

  it('nhận cả URL có query string', async () => {
    const win = fakeWindow()
    const seen: string[] = []
    installCaptionHook(win, (u) => seen.push(u))
    await win.fetch('https://x.udemycdn.com/c/en.vtt?token=abc')
    expect(seen).toHaveLength(1)
  })

  it('vẫn trả về Response gốc cho trang', async () => {
    const win = fakeWindow()
    installCaptionHook(win, () => {})
    const res = await win.fetch('https://x.udemycdn.com/c/en.vtt')
    expect(await res.text()).toBe('ok')
  })

  it('gỡ hook thì khôi phục fetch gốc', async () => {
    const win = fakeWindow()
    const original = win.fetch
    const uninstall = installCaptionHook(win, () => {})
    expect(win.fetch).not.toBe(original)
    uninstall()
    expect(win.fetch).toBe(original)
  })

  it('không làm hỏng lỗi mạng của trang', async () => {
    const win = { fetch: vi.fn(async () => { throw new Error('offline') }) } as unknown as WindowLike
    installCaptionHook(win, () => {})
    await expect(win.fetch('https://x.udemycdn.com/c/en.vtt')).rejects.toThrow('offline')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- caption-hook`
Expected: FAIL — `Cannot find module './caption-hook'`

- [ ] **Step 3: Viết `src/player/caption-hook.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test hook để xác nhận pass**

Run: `npm test -- caption-hook`
Expected: PASS, 6 test

- [ ] **Step 5: Viết entrypoint MAIN world**

File `src/entrypoints/caption-hook.content.ts`:

```ts
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
```

- [ ] **Step 6: Viết test thất bại cho đường dự phòng textTracks**

File `src/player/caption-source.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cuesFromTextTracks } from './caption-source'

function videoWithTrack(): HTMLVideoElement {
  const video = document.createElement('video')
  const track = video.addTextTrack('captions', 'English', 'en')
  track.addCue(new VTTCue(1, 3, 'first line'))
  track.addCue(new VTTCue(3, 5, 'second line'))
  return video
}

describe('cuesFromTextTracks', () => {
  it('đọc được cue từ text track', () => {
    const cues = cuesFromTextTracks(videoWithTrack())
    expect(cues).toEqual([
      { start: 1, end: 3, text: 'first line' },
      { start: 3, end: 5, text: 'second line' },
    ])
  })

  it('trả mảng rỗng khi video không có track', () => {
    expect(cuesFromTextTracks(document.createElement('video'))).toEqual([])
  })
})
```

- [ ] **Step 7: Chạy test để xác nhận thất bại**

Run: `npm test -- caption-source`
Expected: FAIL — `Cannot find module './caption-source'`

- [ ] **Step 8: Viết `src/player/caption-source.ts`**

```ts
import type { Cue } from '../core/types'

/**
 * Fallback for when no .vtt request is seen — the page may have served the
 * captions from its own cache. Setting mode to 'hidden' makes the browser load
 * the cues without drawing them over the video.
 */
export function cuesFromTextTracks(video: HTMLVideoElement): Cue[] {
  const cues: Cue[] = []

  for (const track of Array.from(video.textTracks)) {
    if (track.kind !== 'captions' && track.kind !== 'subtitles') continue
    track.mode = 'hidden'
    for (const cue of Array.from(track.cues ?? [])) {
      const text = (cue as VTTCue).text?.replace(/<[^>]*>/g, '').trim()
      if (!text) continue
      cues.push({ start: cue.startTime, end: cue.endTime, text })
    }
    if (cues.length > 0) break
  }

  return cues.sort((a, b) => a.start - b.start)
}
```

- [ ] **Step 9: Chạy test để xác nhận pass**

Run: `npm test -- caption-source`
Expected: PASS, 2 test

- [ ] **Step 10: Commit**

```bash
git add extension/src/player/caption-hook.ts extension/src/player/caption-hook.test.ts \
        extension/src/player/caption-source.ts extension/src/player/caption-source.test.ts \
        extension/src/entrypoints/caption-hook.content.ts
git commit -m "feat: capture Udemy's caption URL and fall back to text tracks"
```

---

### Task 12: Service worker — dịch qua Gemini

**Files:**
- Create: `extension/src/entrypoints/background.ts`
- Create: `extension/src/background/gemini.ts`
- Test: `extension/src/background/gemini.test.ts`

**Interfaces:**
- Consumes: `buildPrompt` (Task 6), `matchTranslations` (Task 6), `Segment` (Task 1)
- Produces: `translateBatch(batch: Segment[], apiKey: string, fetchImpl?: typeof fetch): Promise<Map<number, string>>`

- [ ] **Step 1: Viết test thất bại**

File `src/background/gemini.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { translateBatch } from './gemini'
import type { Segment } from '../core/types'

const batch: Segment[] = [
  { id: 1, start: 0, end: 2, srcText: 'hello', status: 'pending' },
]

const reply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })

describe('translateBatch', () => {
  it('trả về map id sang bản dịch', async () => {
    const f = vi.fn(async () => reply('[{"id":1,"vi":"xin chào"}]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(out.get(1)).toBe('xin chào')
  })

  it('gửi key trong header chứ không trong URL', async () => {
    const f = vi.fn(async () => reply('[{"id":1,"vi":"xin chào"}]'))
    await translateBatch(batch, 'SECRET', f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('SECRET')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET')
  })

  it('thử lại khi lô đầu thiếu id', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply('[]'))
      .mockResolvedValueOnce(reply('[{"id":1,"vi":"xin chào"}]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(2)
    expect(out.get(1)).toBe('xin chào')
  })

  it('bỏ cuộc sau hai lần thử lại và trả về phần dịch được', async () => {
    const f = vi.fn(async () => reply('[]'))
    const out = await translateBatch(batch, 'KEY', f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(3)
    expect(out.size).toBe(0)
  })

  it('ném lỗi rõ ràng khi key sai, không thử lại', async () => {
    const f = vi.fn(async () => new Response('forbidden', { status: 401 }))
    await expect(translateBatch(batch, 'BAD', f as unknown as typeof fetch)).rejects.toThrow(/key/i)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm test -- gemini`
Expected: FAIL — `Cannot find module './gemini'`

- [ ] **Step 3: Viết `src/background/gemini.ts`**

```ts
import { buildPrompt } from '../core/translate/prompt'
import { matchTranslations } from '../core/translate/validate'
import type { Segment } from '../core/types'

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'

const MAX_ATTEMPTS = 3

export class InvalidApiKeyError extends Error {
  constructor() {
    super('API key bị từ chối. Mở trang cài đặt để nhập lại.')
    this.name = 'InvalidApiKeyError'
  }
}

async function callOnce(prompt: string, apiKey: string, f: typeof fetch): Promise<string> {
  const res = await f(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  })

  if (res.status === 401 || res.status === 403) throw new InvalidApiKeyError()
  if (!res.ok) throw new Error(`translation request failed: ${res.status}`)

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

/**
 * Translates one batch, re-asking only for the entries the model failed to
 * return. Batched translation drops or renumbers ids often enough that this
 * retry loop is load-bearing, not defensive padding.
 */
export async function translateBatch(
  batch: Segment[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  let remaining = batch

  for (let attempt = 0; attempt < MAX_ATTEMPTS && remaining.length > 0; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt))

    const raw = await callOnce(buildPrompt(remaining), apiKey, fetchImpl)
    const { matched, missing } = matchTranslations(remaining, raw)
    for (const [id, vi] of matched) result.set(id, vi)

    const missingSet = new Set(missing)
    remaining = remaining.filter((s) => missingSet.has(s.id))
  }

  return result
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- gemini`
Expected: PASS, 5 test

- [ ] **Step 5: Viết service worker**

File `src/entrypoints/background.ts`:

```ts
import { translateBatch } from '../background/gemini'
import type { Segment } from '../core/types'

export interface TranslateRequest {
  type: 'translate'
  batch: Segment[]
}

export interface FetchCaptionRequest {
  type: 'fetch-caption'
  url: string
}

type Request = TranslateRequest | FetchCaptionRequest

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
    if (msg.type === 'translate') {
      chrome.storage.local.get('apiKey').then(async ({ apiKey }) => {
        if (typeof apiKey !== 'string' || apiKey === '') {
          sendResponse({ error: 'Chưa có API key. Mở trang cài đặt để nhập.' })
          return
        }
        try {
          const map = await translateBatch(msg.batch, apiKey)
          sendResponse({ translations: Array.from(map.entries()) })
        } catch (e) {
          sendResponse({ error: e instanceof Error ? e.message : String(e) })
        }
      })
      return true
    }

    if (msg.type === 'fetch-caption') {
      // The page's own cookies are needed; the service worker has them.
      fetch(msg.url, { credentials: 'include' })
        .then((r) => r.text())
        .then((text) => sendResponse({ text }))
        .catch((e) => sendResponse({ error: String(e) }))
      return true
    }

    return false
  })
})
```

- [ ] **Step 6: Commit**

```bash
git add extension/src/background/ extension/src/entrypoints/background.ts
git commit -m "feat: translate batches through Gemini in the service worker"
```

---

### Task 13: Trang cài đặt để nhập API key

**Files:**
- Create: `extension/src/entrypoints/options/index.html`, `extension/src/entrypoints/options/main.ts`
- Modify: `extension/wxt.config.ts` (không cần đổi; WXT tự nhận thư mục `options`)

**Interfaces:**
- Consumes: `chrome.storage.local`
- Produces: khoá `apiKey` trong `chrome.storage.local`

- [ ] **Step 1: Viết `index.html`**

```html
<!doctype html>
<meta charset="utf-8" />
<title>Udemy Dubbing — Cài đặt</title>
<style>
  body { font: 15px system-ui, sans-serif; max-width: 520px; margin: 40px auto; padding: 0 20px; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input { width: 100%; padding: 8px; font: inherit; }
  p { color: #555; }
  #status { margin-top: 12px; font-weight: 600; }
</style>
<h1>Udemy Dubbing</h1>
<label for="key">Gemini API key</label>
<input id="key" type="password" autocomplete="off" />
<p>Key chỉ lưu trên máy này. Không đồng bộ lên tài khoản Google.</p>
<button id="save">Lưu</button>
<div id="status"></div>
<script type="module" src="./main.ts"></script>
```

- [ ] **Step 2: Viết `main.ts`**

```ts
const input = document.querySelector<HTMLInputElement>('#key')!
const button = document.querySelector<HTMLButtonElement>('#save')!
const status = document.querySelector<HTMLDivElement>('#status')!

// storage.local, never storage.sync: secrets should not ride along to other
// machines on the user's Google account.
void chrome.storage.local.get('apiKey').then(({ apiKey }) => {
  if (typeof apiKey === 'string') input.value = apiKey
})

button.addEventListener('click', async () => {
  await chrome.storage.local.set({ apiKey: input.value.trim() })
  status.textContent = 'Đã lưu.'
  setTimeout(() => (status.textContent = ''), 2000)
})
```

- [ ] **Step 3: Kiểm tra build chạy được**

Run: `npm run build`
Expected: build thành công, có `.output/chrome-mv3/`

- [ ] **Step 4: Commit**

```bash
git add extension/src/entrypoints/options/
git commit -m "feat: add an options page for the Gemini API key"
```

---

### Task 14: Nối content script — bản chạy được đầu tiên

**Files:**
- Create: `extension/src/entrypoints/content.ts`
- Modify: `extension/src/core/scheduler.ts` (không đổi API, chỉ dùng)

**Interfaces:**
- Consumes: mọi thứ từ Task 2–12
- Produces: extension chạy thật trên Udemy

- [ ] **Step 1: Viết content script**

File `src/entrypoints/content.ts`:

```ts
import { planBatches } from '../core/batching'
import { Scheduler } from '../core/scheduler'
import { mergeCues } from '../core/segmenter'
import type { Cue, Segment } from '../core/types'
import { parseVtt } from '../core/vtt'
import { CAPTION_MESSAGE } from '../player/caption-hook'
import { cuesFromTextTracks } from '../player/caption-source'
import { createPlayerBridge } from '../player/player-bridge'
import { WebSpeechProvider } from '../providers/web-speech'

export default defineContentScript({
  matches: ['https://www.udemy.com/*'],
  runAt: 'document_idle',

  main() {
    const provider = new WebSpeechProvider()
    const bridge = createPlayerBridge(document)

    let scheduler: Scheduler | null = null
    let segments: Segment[] = []
    let rafId = 0
    let captionUrl: string | null = null

    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = event.data as { type?: string; url?: string }
      if (data?.type === CAPTION_MESSAGE && typeof data.url === 'string') captionUrl = data.url
    })

    const loadCues = async (video: HTMLVideoElement): Promise<Cue[]> => {
      if (captionUrl !== null) {
        const res = (await chrome.runtime.sendMessage({ type: 'fetch-caption', url: captionUrl })) as {
          text?: string
        }
        if (typeof res?.text === 'string') {
          const cues = parseVtt(res.text)
          if (cues.length > 0) return cues
        }
      }
      return cuesFromTextTracks(video)
    }

    const translateAll = async (video: HTMLVideoElement) => {
      for (const batch of planBatches(segments, video.currentTime)) {
        const res = (await chrome.runtime.sendMessage({ type: 'translate', batch })) as {
          translations?: [number, string][]
          error?: string
        }
        if (res?.error) {
          console.warn('[udemy-dubbing]', res.error)
          return
        }
        for (const [id, vi] of res.translations ?? []) {
          const seg = segments.find((s) => s.id === id)
          if (seg) {
            seg.viText = vi
            seg.status = 'ready'
          }
        }
        scheduler?.setSegments(segments)
      }
    }

    const loop = () => {
      void scheduler?.tick()
      rafId = requestAnimationFrame(loop)
    }

    bridge.on('attached', async (video) => {
      const cues = await loadCues(video)
      if (cues.length === 0) {
        console.warn('[udemy-dubbing] Bài giảng này không có phụ đề.')
        return
      }

      segments = mergeCues(cues)
      scheduler = new Scheduler({ video, provider })
      scheduler.setSegments(segments)
      scheduler.setBaseline(video.playbackRate)

      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(loop)

      void translateAll(video)
    })

    bridge.on('seeked', () => scheduler?.onSeek())
    bridge.on('ratechange', (rate) => scheduler?.setBaseline(rate))
    bridge.on('detached', () => {
      cancelAnimationFrame(rafId)
      scheduler?.stop()
      scheduler = null
      captionUrl = null
    })

    bridge.start()
  },
})
```

- [ ] **Step 2: Build và nạp vào Chrome**

```bash
cd /Users/anhdh/dubbing/extension
npm run build
```

Mở `chrome://extensions`, bật Developer mode, chọn **Load unpacked**, trỏ vào `extension/.output/chrome-mv3`.

- [ ] **Step 3: Nhập API key**

Mở trang options của extension, dán Gemini API key, bấm Lưu.

- [ ] **Step 4: Chạy toàn bộ test để chắc không vỡ gì**

Run: `npm test`
Expected: PASS toàn bộ

- [ ] **Step 5: Commit**

```bash
git add extension/src/entrypoints/content.ts
git commit -m "feat: wire the dubbing pipeline together in the content script"
```

---

### Task 15: E2E trên trang fixture

Trang fixture mô phỏng Udemy đủ để chạy trong CI mà không cần tài khoản.

**Files:**
- Create: `extension/tests/fixtures/lecture.html`, `extension/tests/fixtures/sample.vtt`
- Create: `extension/tests/e2e/dubbing.spec.ts`
- Create: `extension/playwright.config.ts`

**Interfaces:**
- Consumes: bản build trong `.output/chrome-mv3`
- Produces: một e2e test chạy được trong CI

- [ ] **Step 1: Cài Playwright**

```bash
cd /Users/anhdh/dubbing/extension
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Viết fixture**

File `tests/fixtures/sample.vtt`:

```
WEBVTT

00:00:01.000 --> 00:00:03.000
In this lesson we will build

00:00:03.000 --> 00:00:05.000
a React component.

00:00:06.000 --> 00:00:09.000
Then we call the API with FastAPI.
```

File `tests/fixtures/lecture.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Fixture lecture</title>
<video id="v" width="480" controls>
  <track kind="captions" src="./sample.vtt" srclang="en" default />
</video>
<script>
  // Mimics Udemy fetching its caption file, which is what the MAIN-world
  // hook listens for.
  fetch('./sample.vtt').then((r) => r.text())
</script>
```

- [ ] **Step 3: Viết `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { headless: false },
  webServer: {
    command: 'npx http-server tests/fixtures -p 5599 --silent',
    port: 5599,
    reuseExistingServer: true,
  },
})
```

Cài server tĩnh: `npm install --save-dev http-server`

- [ ] **Step 4: Viết e2e test**

File `tests/e2e/dubbing.spec.ts`:

```ts
import path from 'node:path'
import { chromium, expect, test } from '@playwright/test'

const EXT = path.resolve(__dirname, '../../.output/chrome-mv3')

test('bắt được URL phụ đề và gộp thành segment', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })

  const page = await context.newPage()
  const logs: string[] = []
  page.on('console', (m) => logs.push(m.text()))

  await page.goto('http://127.0.0.1:5599/lecture.html')
  await page.waitForTimeout(2000)

  // Không có phụ đề thì extension phải báo, chứ không im lặng.
  const complained = logs.some((l) => l.includes('không có phụ đề'))
  expect(complained).toBe(false)

  await context.close()
})
```

- [ ] **Step 5: Chạy e2e**

Run: `npx playwright test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extension/tests/ extension/playwright.config.ts extension/package.json
git commit -m "test: add an end-to-end run against a local Udemy-like fixture"
```

---

### Task 16: Kiểm chứng trên Udemy thật

Đây là task duy nhất không tự động hoá được, và nó đóng câu hỏi treo số 1 trong spec.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-udemy-realtime-dubbing-design.md` (mục 4.5 và mục 13)

- [ ] **Step 1: Mở một bài giảng Udemy có phụ đề tiếng Anh**

Mở DevTools, tab Network, lọc theo `vtt`.

- [ ] **Step 2: Ghi lại dạng endpoint thật**

Ghi lại: URL đầy đủ của file `.vtt`, và nếu có, endpoint API trả về JSON liệt kê caption cùng tên trường chứa URL.

- [ ] **Step 3: Kiểm tra hook có bắt được không**

Trong Console, kiểm tra `captionUrl` có được đặt không. Nếu không có request `.vtt` nào xuất hiện, xác nhận đường dự phòng `textTracks` có chạy.

- [ ] **Step 4: Xem thử một đoạn và ghi nhận**

Ghi lại: tiếng có khớp hình không, có bị hụt câu nào không, có lúc nào video bị làm chậm thấy rõ không.

- [ ] **Step 5: Cập nhật spec**

Thay đoạn "Cần xác nhận ở M1" trong mục 4.5 bằng dạng endpoint thật đã quan sát được. Xoá câu hỏi số 1 khỏi mục 13.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-20-udemy-realtime-dubbing-design.md
git commit -m "docs: record Udemy's real caption endpoint and close the open question"
```

---

## Hoàn thành M1

Sau task 16, bạn có một extension nạp được vào Chrome, đọc phụ đề Udemy, dịch sang tiếng Việt và đọc lên đồng bộ với video — bằng giọng Web Speech. M2 thay `WebSpeechProvider` bằng `VieNeuProvider` gọi tới server ở `server/app.py`, và vì cả hai cùng cài `TTSProvider` nên không có file nào ngoài `providers/` phải sửa.
