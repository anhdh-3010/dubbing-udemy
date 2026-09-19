# Udemy Real-Time Dubbing Extension — Design

**Date:** 2026-09-20
**Status:** Design approved; ready for implementation planning
**Scope:** Personal-use Chrome extension (Manifest V3), loaded unpacked. Not published to the Chrome Web Store.

---

## 1. Problem

Udemy courses are taught in English. Reading subtitles competes for attention with the screen — which is where the code being explained actually is. This extension speaks the lecture in Vietnamese while the original video plays, in real time, at no recurring cost.

## 2. Approach

Udemy ships timed caption files for most lectures, and the whole file is available before playback reaches any given line. That single fact shapes the entire design: the extension can translate and synthesize **ahead of the playhead** instead of reacting to audio. No speech recognition, no streaming ASR, no per-second latency budget.

On lecture open, the extension reads the caption cues, merges them into sentences, translates them in batches — prioritizing the batch containing the current playback position so audio starts within a few seconds — and synthesizes speech just ahead of the playhead. Original audio is ducked, not muted. The video never pauses.

## 3. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transcript source | Udemy's own caption track (`video.textTracks`) | Exact timestamps, full text known in advance, no ASR cost or latency |
| Translation | LLM API, user-supplied key (Gemini free tier) | Whole-lecture context beats sentence-by-sentence MT on technical material; free tier covers personal use |
| Speech | VieNeu v3 Nano, voice **Minh Quân**, via local HTTP server | Highest Vietnamese quality that runs free and offline on this machine; 11 preset voices; OpenAI-compatible API |
| Speech fallback | Web Speech API (`Linh`) | Keeps the extension usable when the local server is down |
| Sync strategy | Adaptive stretching; never pause the video | Pausing makes lectures stutter and inflates runtime |
| Batch strategy | Translate whole lecture in background, current batch first | Latency of streaming with the quality and cacheability of whole-file translation |
| Subtitles | Vietnamese subtitle overlay | Nearly free once translation exists; lets the reader check the audio |
| Glossary UI | Deferred to v2 | Keeping technical terms in English is one prompt line and needs no interface |

### Explicitly out of scope for v1

Chrome Web Store packaging, onboarding flows, privacy policy, multi-browser support, cloud TTS providers, editable glossary UI, voice cloning.

## 4. Architecture

### 4.1 Process boundaries

Three processes, split by what each one is allowed to do:

**Content script** (runs in the Udemy page) owns everything time-sensitive: the `<video>` element, the scheduler loop, audio playback, the subtitle overlay and the control panel. All timing logic lives here, in one place.

**Service worker** owns network access and secrets: the LLM API key, translation calls, and requests to the local TTS server. It is deliberately stateless about playback, because MV3 terminates it without warning.

**Local TTS server** (`vieneu`, outside the browser) owns speech synthesis. The extension talks to it over `http://127.0.0.1:<port>/v1/audio/speech`.

Audio bytes flow service worker → content script for playback. Synthesis can happen anywhere; **playback must sit next to the video**.

### 4.2 Why the TTS server may be plain HTTP

Udemy is served over HTTPS, so a plain-HTTP request would normally be blocked as mixed content. Chrome exempts `http://127.0.0.1` and `http://localhost` — they are classified as potentially trustworthy origins. This is what makes a local server practical without a certificate, a domain, or authentication. It is also why the server must stay on loopback: the exemption does not extend to a LAN or public address.

### 4.3 Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `player-bridge` | Attach to Udemy's `<video>`; emit play/pause/seek/ratechange; detect lecture changes (Udemy is an SPA, there is no page reload) | DOM |
| `caption-source` | Produce `Cue[]`. Primary: read `video.textTracks` with `mode = 'hidden'`. Fallback: fetch the `.vtt` URL from Udemy's lecture API | `player-bridge` |
| `segmenter` | Merge fragmentary cues (Udemy splits at 3–6 words) into whole sentences, bounded by punctuation, silence gaps, and a 12s ceiling | pure |
| `translator` | Batch ~40 segments per LLM call; produce `displayText` and `speechText` together; validate and match results by id | `cache` |
| `tts-provider` | `TTSProvider` interface. `VieNeuProvider` (primary), `WebSpeechProvider` (fallback) | — |
| `scheduler` | The core loop: read `currentTime` each frame, decide what to speak, compute rates, drive ducking and `playbackRate` | all of the above |
| `cache` | IndexedDB: translations keyed by lecture, synthesized audio, LRU eviction | — |
| `ui` | Control panel and subtitle overlay in a Shadow DOM; options page | `scheduler` |

### 4.4 Data flow

```
lecture change (SPA)
  → player-bridge emits { videoEl, lectureId }
  → caption-source yields Cue[]
  → segmenter merges into Segment[]
  → service worker splits into batches, PRIORITIZES the batch containing currentTime
  → LLM translates → content script receives → cache persists
  → scheduler speaks; remaining batches arrive in the background
```

## 5. Data model

```ts
interface Cue {
  start: number          // seconds
  end: number
  text: string
}

interface Segment {
  id: number
  start: number          // seconds, from the source caption timeline
  end: number
  srcText: string        // original English
  displayText?: string   // Vietnamese, for the subtitle overlay
  speechText?: string    // Vietnamese, terms transliterated, for TTS
  status: 'pending' | 'translating' | 'ready' | 'failed'
}

interface SynthesisResult {
  audio: ArrayBuffer     // 24 kHz WAV from VieNeu
  duration: number       // exact, known before playback begins
}

interface TTSProvider {
  readonly knowsDurationAhead: boolean
  isAvailable(): Promise<boolean>
  synthesize(text: string, signal: AbortSignal): Promise<SynthesisResult>
}
```

`displayText` and `speechText` are two renderings of the same sentence and are produced by a single LLM call. Section 7 explains why they differ.

## 6. Synchronisation

### 6.1 The anchor rule

Every segment is anchored to its own `start` time. Segments are never chained end-to-end. This is what prevents drift from accumulating: an error in one sentence dies with that sentence.

### 6.2 Rate computation

Vietnamese translations usually run longer than the English they came from, so most segments need compressing. Three tiers, applied in order:

1. The LLM is instructed to translate concisely, targeting ±15% of the source duration.
2. TTS playback rate is raised, clamped to `[1.0, 1.4]`. Past 1.4 the speech stops being comfortable.
3. Only if that is still not enough, the video slows down — floored at 15% below the user's chosen speed.

```
W        = (segment.end - segment.start) + gapAfter   // video-time seconds
                                                      // gapAfter = silence before the next segment starts
haveWall = W / baseline                               // wall seconds available
r        = clamp(duration / haveWall, 1.0, 1.4)       // TTS rate
needWall = duration / r

if needWall > haveWall:
    videoRate = max(0.85 * baseline, W / needWall)
else:
    videoRate = baseline
```

`baseline` is the playback speed **the user chose** — not 1.0. Udemy learners commonly watch at 1.25× or 1.5×, which shrinks the real time budget by exactly that factor. Every calculation is relative to `baseline`, and the slowdown floor is relative too, so a 1.5× viewer is never dropped to 0.85× absolute.

VieNeu reports exact duration before playback, so this resolves in one pass. The adaptive estimator (measured characters-per-second, refined by a moving average after each utterance) exists only for `WebSpeechProvider`, which cannot report duration in advance.

### 6.3 Ducking

On utterance start, `video.volume` fades to the configured level (default 0.1) over ~120ms; it fades back when the utterance ends. The fade avoids a click at every sentence boundary.

### 6.4 Event handling

| Event | Behaviour |
|---|---|
| Seek | Abort current synthesis and playback, binary-search the new segment index, restore volume and `playbackRate` |
| Pause | Pause audio; resume in place |
| User changes speed | Record as the new `baseline`; recompute from there |
| Lecture change | Tear down completely and rebuild |

## 7. Term transliteration

A Vietnamese-only TTS model has never seen English phonetics during training. Feeding it "React component" produces artifacts. But the target was wrong to begin with: Vietnamese instructors do not pronounce "component" with an American accent mid-sentence — they say "com-pô-nen".

So the translator emits two renderings per segment. `displayText` keeps "React component" because that is what a reader wants to *see*. `speechText` carries the transliterated form because that is what sounds right *spoken*. One LLM call produces both, so this costs no extra requests.

**Constraint:** transliterations must use orthography that is legal in Vietnamese. Measured during design: "prốp" failed because Vietnamese has no `pr` consonant cluster — the phonemizer fell back to English and in one case spelled the word out letter by letter. "pờ-rốp" was clean.

**Automated check:** running `speechText` through `espeak-ng -v vi -q --ipa` and looking for `(en)` language-switch markers detects illegal transliterations without anyone listening. This is used as an independent linter — VieNeu uses its own `sea-g2p` phonemizer, so this validates the *text*, not VieNeu's internals.

This feature is a setting, default on. See open question 1.

## 8. Local TTS server

**Runtime:** `vieneu` (v3.8.1 verified), ONNX path, no PyTorch. Model `VieNeu-TTS-v3-Nano`, ~282MB, 24 kHz, voice `Minh Quân`.

**Endpoint:** `POST http://127.0.0.1:<port>/v1/audio/speech`, OpenAI-compatible. One consequence worth stating: a single `TTSProvider` implementation covers both this server and OpenAI's hosted API, should a cloud option ever be wanted. Only the base URL differs.

**Requirements:**
- Server sets `Access-Control-Allow-Origin: chrome-extension://<extension id>`.
- Extension declares `host_permissions: ["http://127.0.0.1/*"]` (match patterns ignore ports, so this covers any port).
- Requests are issued from the service worker, not the content script, so they run on the extension origin and are not subject to the page's CSP.
- A `launchd` user agent keeps the server running across reboots.

**Availability:** the scheduler probes the server on lecture start and on failure. When it is unreachable, the extension falls back to `WebSpeechProvider` and says so in the control panel rather than going silent.

**Note on quantisation:** VieNeu's int8 build is ~1.6× faster but requires AVX-512 VNNI / AVX-VNNI — x86 instruction sets that Apple Silicon does not have, and the documentation warns of garbled audio without them. On this machine only the fp32 path is usable. The `steps` parameter is the tuning knob instead (see open question 2).

## 9. Caching

IndexedDB, owned by the service worker.

- **Translations** keyed by `lectureId + captionLang + targetLang + model`. Re-watching a lecture costs nothing.
- **Audio** keyed by `segment hash + voice + steps`, evicted LRU against a configurable quota.
- On quota exhaustion: evict, retry once, then run without caching rather than failing.

## 10. Error handling

The governing principle: when anything breaks, fall back to watching the video normally. Never go silent without saying why.

| Failure | Behaviour |
|---|---|
| Lecture has no captions | Say so in the panel, disable dubbing, leave the video alone |
| Invalid or exhausted API key | Clear message linking to options; **stop calling the API** rather than retrying forever |
| A translation batch fails | Retry twice with backoff; then those segments play **original audio at full volume** |
| LLM returns wrong or missing ids | Accept only matching ids; re-queue the rest. This happens in practice with batch translation and must be validated |
| TTS server unreachable | Fall back to Web Speech, surface the state in the panel |
| Synthesis fails for one segment | Skip it; original audio plays at full volume for that span |
| IndexedDB full | LRU evict; if still failing, run uncached |
| Service worker terminated | Content script holds state, detects the closed port, reconnects and re-requests what is missing |

## 11. Testing

The sync engine is where bugs will live, and almost all of it is testable without a browser.

**Unit (Vitest), pure functions:** cue merging, rate computation, batch splitting, segment index lookup, LLM response validation, transliteration linting.

**Scheduler (Vitest + fakes):** `FakeTranslator` returns text of controllable length; `FakeTTS` reports arbitrary durations; a virtual clock drives a fake video element. This covers the hard cases — a translation twice as long as its slot, a seek mid-utterance, a speed change while speaking — with no Udemy and no audio hardware.

**End-to-end (Playwright):** a local fixture page with a `<video>` and a VTT track shaped like Udemy's, with the real extension loaded. Runs in CI, needs no Udemy account.

**Manual:** `player-bridge` only. It is the one module whose environment cannot be faithfully faked.

## 12. Milestones

**M1 — the pipeline runs.** `player-bridge`, `caption-source`, `segmenter`, translator, `WebSpeechProvider`, `scheduler`. Zero setup, so the sync engine can be validated on its own before the server is introduced. Done when a real Udemy lecture plays dubbed in Vietnamese.

**M2 — real voice.** `VieNeuProvider`, local server, `launchd` agent, availability probing and fallback.

**M3 — usable daily.** IndexedDB cache, control panel, Vietnamese subtitle overlay, options page.

**M4 — sharp edges.** Transliteration linting, the full error-handling table, cache eviction tuning.

## 13. Open questions

1. **Does transliteration help or hurt with VieNeu Nano?** Nano is documented as weak on code-switched En-Vi text, which is what transliteration is meant to sidestep — but Nano may already render English with a Vietnamese accent that sounds natural. Ship the setting, decide on real lectures.
2. **Is 8-step synthesis audibly worse than 16?** If not, use 8: measured RTF drops from 0.18 to 0.094, halving CPU use — which matters on battery.
3. **Do Udemy's `textTracks` always expose the full cue list?** Side-loaded VTT does; segmented in-band HLS subtitles may not. The lecture-API fallback exists for this, but the trigger condition needs confirming against real courses.
4. **Should the server run always or on demand?** Always-on is simpler and costs idle RAM; on-demand saves resources but adds startup latency to the first sentence.

---

## Appendix A — Measurements

Taken during design on the target machine: **Apple M2 Pro, 10 cores (6P/4E), 16GB RAM, arm64**.

| Engine | Same paragraph | RTF | Notes |
|---|---|---|---|
| Apple `Linh (Enhanced)` | 13.33s | 0.12 | Not reachable through Web Speech; needs native messaging |
| Apple `Linh` (compact) | not measured | — | The only Vietnamese voice Chrome's Web Speech exposes; measured 5.56s vs 5.17s for Enhanced on a shorter sentence |
| Piper `vais1000-medium` | 9.85s | 0.045 | Best official Piper Vietnamese voice; ~1,000 training utterances |
| Piper-format `CSA v3` | 9.53s | 0.061 | 257h synthetic training data, 5 speakers |
| **VieNeu v3 Nano, 16 steps** | **10.67s** | **0.18** | 24 kHz, 11 preset voices — **chosen** |
| VieNeu v3 Nano, 8 steps | 10.69s | 0.094 | Quality difference not yet assessed |

Cold model load including download: 56.7s. Warm load: ~3s per upstream documentation.

For reference, Apple's voice reads the same paragraph 25% slower than VieNeu, which directly increases how often the compression tiers in §6.2 have to engage.
