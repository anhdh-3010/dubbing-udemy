# M2 — Giọng thật

> **Dành cho agent thực thi:** BẮT BUỘC DÙNG SUB-SKILL `superpowers:subagent-driven-development` (khuyến nghị) hoặc `superpowers:executing-plans` để thực hiện plan này theo từng task. Các bước dùng cú pháp checkbox (`- [ ]`) để theo dõi.

**Mục tiêu:** Một bài giảng Udemy thật phát ra tiếng Việt bằng giọng VieNeu, đồng bộ với video, và tự nói ra khi server không chạy thay vì im lặng.

**Kiến trúc:** Server VieNeu chạy native dưới `launchd` trên `127.0.0.1:8770`. Service worker gọi server, nhận WAV, mã hóa base64 và gửi sang content script; content script dựng Blob, phát bằng `HTMLAudioElement` với `preservesPitch`. Scheduler chuẩn bị trước đúng một câu để 0.5–1.8 giây tổng hợp không rơi vào trong khung thời gian của câu. `FallbackProvider` bọc VieNeu và Web Speech nên scheduler không biết là có hai engine.

**Tech stack:** Python 3.14 + uv cho server; TypeScript, WXT, Vitest, Playwright cho extension. `uv` đã có sẵn (0.7.2). Node v20.17.0, npm 10.8.2.

**Spec:** `docs/superpowers/specs/2026-09-20-udemy-realtime-dubbing-design.md` — nguồn phân xử bắt buộc khi plan và spec bất đồng. Mục liên quan: 4.1, 4.2, 6.2, 6.4, 6.5, 8, 8.1, 8.3, 8.4, 10, 12.

**Bối cảnh từ M1:** `docs/superpowers/2026-09-20-m1-verification.md` (lần chạy thật, sáu lỗi nó phát hiện) và `docs/superpowers/2026-09-20-m1-rulings.md` (52 quyết định đã chốt). Đọc mục "Việc còn lại" của bản verification trước khi làm Task 6.

## Ràng buộc toàn cục

Áp dụng cho mọi task, không nhắc lại ở từng task:

- **Ngôn ngữ code và comment: tiếng Anh.** Chuỗi hiển thị cho người dùng: tiếng Việt.
- **Chạy lệnh npm từ `extension/`**, không phải từ gốc repo. Chạy `npx vitest` ở gốc repo sẽ làm hỏng việc chia environment trong `vitest.config.ts` (glob `src/player/**` không khớp `extension/src/player/**`) và 10 test sẽ đỏ vì lý do giả.
- **Không thêm thư viện ngoài.** M2 không cần gói npm mới nào.
- **`strict: true`.** Không dùng `any` khi có kiểu cụ thể.
- **`src/core/` phải thuần túy** — không chạm `window`, `document`, `chrome`, `fetch`, `Audio`. Đây là ranh giới làm cho phần khó nhất test được không cần trình duyệt. `FallbackProvider` và phần prefetch của scheduler nằm trong ranh giới này; `VieNeuProvider` và trình phát audio thì không.
- **Tiêm phụ thuộc thay vì global.** Theo đúng lối M1 đã dùng (`translateBatch(batch, key, fetchImpl = fetch)`, `installCaptionHook(win, onUrl)`): mọi thứ chạm DOM hay `chrome` đều nhận qua tham số có giá trị mặc định, để test không phải dựng trình duyệt.
- **Ngưỡng cố định:** tốc độ đọc TTS kẹp trong `[1.0, 1.4]`; sàn làm chậm video `0.85 * baseline`; ducking `0.1`; trần segment 12 giây; `PREFETCH_LEAD = 10` giây; cooldown dò lại server 30 giây.
- **Server chỉ nghe trên loopback.** Mọi mặc định, mọi script, mọi plist phải là `127.0.0.1`. Không `0.0.0.0` ở bất cứ đâu.
- **Base URL của TTS không bao giờ đến từ message.** Service worker tự giữ hằng số. Content script gửi văn bản, không gửi URL.
- **Commit sau mỗi task**, tiền tố `feat:`, `fix:`, `test:`, `chore:`, `docs:` theo Conventional Commits. Kết mỗi commit message bằng dòng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Sau mỗi task, chạy đủ hai lệnh** từ `extension/`: `npm test` và `npm run typecheck`. Cả hai phải xanh trước khi commit. Nền lúc bắt đầu M2: 148 test xanh.

## Số đo đã có sẵn, không cần đo lại

Đo trên chính máy này (Apple M2 Pro), Python 3.14.2, `vieneu==3.8.1`, model `v3nano`, `steps=8`, `OMP_NUM_THREADS=2`:

| Việc | Thời gian |
|---|---|
| Nạp model (`Vieneu(mode="v3nano")`) | 4.33s |
| **Lần suy luận đầu tiên sau khi nạp** | ~1.8s bất kể câu dài ngắn |
| Câu 2.1 giây audio (ổn định) | 0.26s — RTF 0.124 |
| Câu 7.3 giây audio (ổn định) | 0.62s — RTF 0.085 |
| Câu 16.2 giây audio (ổn định) | 1.45s — RTF 0.089 |

Hai con số đầu là lý do Task 8 phải gửi một request làm nóng: tổng cộng khoảng **6 giây** trôi qua trước khi server đạt tốc độ ổn định, và không có gì che quãng đó nếu không ai chủ động kích hoạt.

---

### Task 1: Môi trường Python native, và sửa hai mặc định sai trong `app.py`

**Files:**
- Create: `server/requirements.txt`
- Modify: `server/app.py` (mặc định `HOST`, `OMP_NUM_THREADS`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: không có
- Produces: `server/.venv/bin/python` chạy được `app.py`; server trả lời trên `http://127.0.0.1:8770`. Task 2 dùng đường dẫn `server/.venv/bin/python` trong plist.

**Bối cảnh:** `vieneu` hiện **không** được cài ở đâu trên máy — chỉ còn trọng số trong `~/.cache/huggingface/hub/models--pnnbao-ump--VieNeu-TTS-v3-Nano`. Số đo trong spec được lấy từ một môi trường đã bị xóa. Đã xác minh khi viết plan này: `vieneu==3.8.1` resolve và chạy được trên Python 3.14.2 (onnxruntime 1.30.0, numpy 2.5.3, sea-g2p 0.9.1), nên **không cần** dựng Python 3.12.

- [ ] **Step 1: Viết `server/requirements.txt`**

```
# Pinned exactly, not floated: this file exists so the launchd agent keeps
# working after an unrelated `uv pip install` elsewhere on the machine.
# vieneu pulls onnxruntime, numpy, sea-g2p and much of the rest; the three
# below are pinned anyway because app.py imports them directly, and a
# transitive pin is not a promise.
vieneu==3.8.1
fastapi==0.141.1
uvicorn==0.53.0
numpy==2.5.3
```

- [ ] **Step 2: Dựng venv và cài**

```bash
cd /Users/anhdh/dubbing/server
uv venv --python 3.14 .venv
uv pip install -p .venv -r requirements.txt
```

Lần cài đầu mất khoảng 2 phút (phần lớn là tải onnxruntime). Không tải trọng số model ở bước này — chúng đã nằm trong cache HuggingFace.

- [ ] **Step 3: Chứng minh engine chạy trước khi đụng tới HTTP**

```bash
cd /Users/anhdh/dubbing/server
OMP_NUM_THREADS=2 ./.venv/bin/python -c "
import time, numpy as np
from vieneu import Vieneu
t0=time.time(); tts=Vieneu(mode='v3nano'); print('load', round(time.time()-t0,2))
t0=time.time(); a=tts.infer('Hôm nay chúng ta sẽ triển khai một project React với backend là FastAPI.', voice='Minh Quân', steps=8); el=time.time()-t0
d=len(np.asarray(a,dtype=np.float32).squeeze())/24000
print('infer', round(el,2), 'audio', round(d,2))
"
```

Expected: `load` khoảng 4.3s, `infer` khoảng 1.8s (lần đầu sau khi nạp luôn chậm — xem bảng số đo ở trên), `audio` khoảng 4.4s. Dòng cảnh báo `HF_TOKEN` là bình thường, bỏ qua.

Nếu bước này hỏng thì dừng lại và báo cáo: mọi thứ sau nó đều vô nghĩa nếu engine không chạy.

- [ ] **Step 4: Sửa mặc định `HOST` trong `server/app.py`**

Dòng cuối file hiện là:

```python
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=PORT, workers=1)
```

Thay bằng:

```python
    # Loopback by default, not 0.0.0.0. The mixed-content exemption that lets
    # an HTTPS page call this server applies to 127.0.0.1 only (spec 4.2), so
    # binding wider buys nothing and exposes the machine to its LAN. Anyone
    # who wants that has to ask for it by name.
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=PORT, workers=1)
```

- [ ] **Step 5: Ép số luồng ONNX ngay trong `app.py`**

Spec mục 8.1 nói `OMP_NUM_THREADS=2` nhanh hơn mặc định 18%. Đặt trong plist là đủ cho đường launchd, nhưng ai chạy tay `./.venv/bin/python app.py` sẽ mất 18% mà không biết vì sao. Biến này phải được đặt **trước** khi onnxruntime được import; `vieneu` chỉ được import bên trong `_engine()` nên đặt ở đầu module là đủ sớm.

Ngay dưới khối `import` ở đầu `server/app.py`, trước dòng `VOICE = ...`, thêm:

```python
# Must be set before onnxruntime is imported, which happens lazily inside
# _engine(). Two threads beat the default by about 18% on this workload —
# it loses to thread contention rather than gaining from more cores (spec
# 8.1). setdefault, not assignment: an explicit value from the environment
# or the launchd plist still wins.
os.environ.setdefault("OMP_NUM_THREADS", "2")
```

- [ ] **Step 6: Bỏ qua `.venv` trong git**

Thêm vào `/Users/anhdh/dubbing/.gitignore`:

```
server/.venv/
```

- [ ] **Step 7: Chạy server và kiểm chứng bốn điều**

Mở một terminal riêng cho server:

```bash
cd /Users/anhdh/dubbing/server && ./.venv/bin/python app.py
```

Ở terminal khác:

```bash
# 1. Nạp lười: model chưa được nạp trước request đầu tiên.
curl -s http://127.0.0.1:8770/health
# Expected: {"status":"ok","model_loaded":false,"voice":"Minh Quân","steps":8}

# 2. Tổng hợp thật, và header thời lượng.
curl -s -D - -o /tmp/m2-probe.wav -X POST http://127.0.0.1:8770/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input":"Hôm nay chúng ta sẽ triển khai một project React với backend là FastAPI."}' \
  | grep -i -E 'HTTP/|x-audio-duration|content-type'
# Expected: HTTP/1.1 200 OK, x-audio-duration khoảng 4.4, content-type: audio/wav

# 3. Model đã nạp sau request đầu tiên.
curl -s http://127.0.0.1:8770/health
# Expected: "model_loaded":true

# 4. Không với tới được từ LAN.
IP=$(ipconfig getifaddr en0) && curl -s -m 3 "http://$IP:8770/health" ; echo "exit=$?"
# Expected: không có output, exit khác 0 (connection refused hoặc timeout)
```

Nghe thử file để biết chắc nó là giọng người chứ không phải nhiễu:

```bash
afplay /tmp/m2-probe.wav
```

- [ ] **Step 8: Dừng server, commit**

Ctrl-C ở terminal server.

```bash
cd /Users/anhdh/dubbing
git add server/requirements.txt server/app.py .gitignore
git commit -m "$(cat <<'MSG'
feat: pin the native Python environment for the TTS server

vieneu was not installed anywhere on this machine — the environment the
spec's measurements came from is gone. Python 3.14.2 turns out to work
(onnxruntime 1.30.0 has wheels for it), so no older interpreter is needed.

Also corrects two defaults that were only safe by accident: HOST fell back
to 0.0.0.0, contradicting spec 4.2 for anyone running app.py by hand, and
OMP_NUM_THREADS=2 lived only in docker-compose.yml, so the native path
silently gave up the 18% it buys.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: launchd agent

**Files:**
- Create: `server/com.udemy-dubbing.tts.plist`
- Create: `server/install-agent.sh`
- Create: `server/uninstall-agent.sh`
- Modify: `server/README.md`

**Interfaces:**
- Consumes: `server/.venv/bin/python` và `server/app.py` từ Task 1
- Produces: server chạy sẵn trên `127.0.0.1:8770` mọi lúc, tự khởi động lại khi chết. Task 3 trở đi giả định nó đang chạy.

**Quyết định đã chốt với người dùng:** `RunAtLoad` + `KeepAlive`, model **giữ trong RAM** sau khi nạp (không tự nhả khi rảnh). Đổi lại là ~478MB RAM thường trực sau câu đầu tiên; đổi lấy việc không bao giờ phải chờ nạp nguội lần hai.

- [ ] **Step 1: Viết `server/com.udemy-dubbing.tts.plist`**

Đây là **template**: `__DIR__` sẽ được script cài đặt thay bằng đường dẫn thật. Không hardcode `/Users/anhdh` vào file trong repo.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.udemy-dubbing.tts</string>

    <key>ProgramArguments</key>
    <array>
        <string>__DIR__/.venv/bin/python</string>
        <string>__DIR__/app.py</string>
    </array>

    <key>WorkingDirectory</key>
    <string>__DIR__</string>

    <key>EnvironmentVariables</key>
    <dict>
        <!-- Loopback only. The mixed-content exemption the extension relies
             on covers 127.0.0.1 and does not extend to a LAN address. -->
        <key>HOST</key>
        <string>127.0.0.1</string>
        <key>PORT</key>
        <string>8770</string>
        <!-- Two threads beat the default by ~18% on this workload. -->
        <key>OMP_NUM_THREADS</key>
        <string>2</string>
        <key>VIENEU_VOICE</key>
        <string>Minh Quân</string>
        <key>VIENEU_STEPS</key>
        <string>8</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>__DIR__/tts.log</string>
    <key>StandardErrorPath</key>
    <string>__DIR__/tts.log</string>
</dict>
</plist>
```

- [ ] **Step 2: Viết `server/install-agent.sh`**

```bash
#!/bin/bash
# Installs the TTS server as a launchd user agent. Idempotent: re-running
# replaces the existing agent rather than failing.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.udemy-dubbing.tts"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -x "$DIR/.venv/bin/python" ]; then
    echo "error: $DIR/.venv/bin/python not found — run the install steps in README.md first" >&2
    exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__DIR__|$DIR|g" "$DIR/$LABEL.plist" > "$TARGET"

# bootout first so this script can be re-run after an edit. An agent that
# was never loaded makes bootout exit non-zero, which is not an error here.
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$TARGET"

echo "installed $TARGET"
echo -n "waiting for the server to answer"
for _ in $(seq 1 20); do
    if curl -fs -m 1 http://127.0.0.1:8770/health >/dev/null; then
        echo " ok"
        curl -s http://127.0.0.1:8770/health
        echo
        exit 0
    fi
    echo -n "."
    sleep 1
done

echo " timed out"
echo "check $DIR/tts.log" >&2
exit 1
```

- [ ] **Step 3: Viết `server/uninstall-agent.sh`**

```bash
#!/bin/bash
# Removes the launchd user agent. Leaves .venv and the model cache alone.
set -euo pipefail

LABEL="com.udemy-dubbing.tts"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$TARGET"
echo "removed $TARGET"
```

- [ ] **Step 4: Cho phép chạy, rồi cài**

```bash
cd /Users/anhdh/dubbing/server
chmod +x install-agent.sh uninstall-agent.sh
./install-agent.sh
```

Expected: `installed /Users/anhdh/Library/LaunchAgents/com.udemy-dubbing.tts.plist`, vài dấu chấm, rồi `{"status":"ok","model_loaded":false,...}`.

- [ ] **Step 5: Chứng minh `KeepAlive` thật sự hoạt động**

```bash
PID=$(launchctl list | awk '/com.udemy-dubbing.tts/ {print $1}') && echo "pid=$PID"
kill -9 "$PID"
sleep 3
curl -s http://127.0.0.1:8770/health && echo
launchctl list | grep com.udemy-dubbing.tts
```

Expected: `/health` trả lời bình thường sau khi bị giết, và PID trong `launchctl list` là một số **khác** `$PID`. Nếu PID không đổi thì bạn đã đọc phải tiến trình sai — thử lại.

- [ ] **Step 6: Xác nhận log đã bị git bỏ qua, và đừng thêm gì**

```bash
cd /Users/anhdh/dubbing && git check-ignore -v server/tts.log
```

Expected: in ra `.gitignore:4:*.log	server/tts.log`. Quy tắc `*.log` sẵn có đã phủ; thêm một dòng nữa chỉ làm `.gitignore` dài ra mà không đổi hành vi.

- [ ] **Step 7: Viết lại phần "Run" của `server/README.md`**

Thay toàn bộ mục `## Run` hiện tại (khối docker-compose) bằng:

````markdown
## Run

Native under `launchd` is the default. Docker still works and is documented
below, but it measured 2.7x slower on this machine (see the table further
down), so it is not what runs day to day.

```bash
uv venv --python 3.14 .venv
uv pip install -p .venv -r requirements.txt
./install-agent.sh
```

`install-agent.sh` writes `~/Library/LaunchAgents/com.udemy-dubbing.tts.plist`
with this directory's real path substituted in, loads it, and waits for
`/health` to answer. The agent has `RunAtLoad` and `KeepAlive`, so the server
comes back after a crash and after a reboot.

The model is loaded on the first synthesis request, not at startup, and stays
in memory afterwards: about 478 MB resident for as long as the agent runs.
That is the deliberate trade — no second cold start, ever.

Logs go to `tts.log` in this directory. To remove the agent:

```bash
./uninstall-agent.sh
```

To run it in the foreground instead, without launchd:

```bash
OMP_NUM_THREADS=2 ./.venv/bin/python app.py
```
````

Cũng sửa mục `## Running it natively instead` ở cuối file — nó giờ mô tả đường mặc định chứ không phải đường thay thế. Thay cả mục đó bằng:

````markdown
## Running it in Docker instead

```bash
docker-compose up -d
curl http://127.0.0.1:8770/health
```

Worth it when you need to stand this up on another machine, or want it gone
without leaving Python behind. Not worth it here: 2.7x slower, same file.
````

- [ ] **Step 8: Commit**

```bash
cd /Users/anhdh/dubbing
git add server/com.udemy-dubbing.tts.plist server/install-agent.sh server/uninstall-agent.sh server/README.md
git commit -m "$(cat <<'MSG'
feat: run the TTS server as a launchd user agent

RunAtLoad plus KeepAlive, with the model kept in memory once loaded: about
478 MB resident, in exchange for never paying the 4.3s cold load twice.

The plist in the repo is a template — install-agent.sh substitutes the real
directory — so the committed file does not carry one machine's home path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Cầu TTS trong service worker

**Files:**
- Create: `extension/src/background/tts.ts`
- Test: `extension/src/background/tts.test.ts`
- Modify: `extension/src/entrypoints/background.ts`
- Modify: `extension/src/entrypoints/__tests__/background.test.ts`
- Modify: `extension/wxt.config.ts`

**Interfaces:**
- Consumes: server từ Task 1/2
- Produces:
  - `TTS_BASE_URL: string`, `TTS_VOICE: string`, `TTS_STEPS: number`
  - `isLoopbackHttpUrl(raw: string): boolean`
  - `ttsHealth(fetchImpl?: typeof fetch, baseUrl?: string): Promise<boolean>`
  - `synthesize(text: string, fetchImpl?: typeof fetch, baseUrl?: string): Promise<SynthesisResult>` với `SynthesisResult = { audio: string; duration: number }`
  - Hai message mới cho content script: `{ type: 'tts-health' }` → `{ ok: boolean }`, và `{ type: 'tts-speak', text: string }` → `{ audio, duration }` hoặc `{ error }`. Task 4 gửi đúng hai message này.

**Ghi chú về CORS.** Service worker fetch tới một host nằm trong `host_permissions` thì Chrome **không** áp CORS — nên phần CORS trong `server/app.py` thực ra không phải thứ làm đường này thông. Giữ nó lại vì nó ghi rõ ý định và vì nó chặn trang web gọi thẳng nếu ai đó sau này bỏ service worker ra khỏi đường đi. Đừng gỡ nó khi thấy mọi thứ vẫn chạy mà không có nó.

- [ ] **Step 1: Viết test trước, `extension/src/background/tts.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { isLoopbackHttpUrl, synthesize, ttsHealth } from './tts'

const BASE = 'http://127.0.0.1:8770'

/** A Response carrying `bytes` as the body and an exact duration header,
 *  shaped like what server/app.py actually returns. */
const wavResponse = (bytes: Uint8Array, duration = 1.5): Response =>
  new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': 'audio/wav', 'X-Audio-Duration': String(duration) },
  })

describe('isLoopbackHttpUrl', () => {
  it('chấp nhận 127.0.0.1 và localhost trên http', () => {
    expect(isLoopbackHttpUrl('http://127.0.0.1:8770')).toBe(true)
    expect(isLoopbackHttpUrl('http://localhost:5599')).toBe(true)
  })

  it('từ chối host khác, kể cả trong dải mạng nội bộ', () => {
    expect(isLoopbackHttpUrl('http://192.168.1.5:8770')).toBe(false)
    expect(isLoopbackHttpUrl('http://evil.example/v1/audio/speech')).toBe(false)
  })

  it('từ chối scheme khác và chuỗi không phải URL', () => {
    // https is not "safer" here — it is a different server. Accepting it
    // would let a redirect or a hosts-file entry move this off the machine.
    expect(isLoopbackHttpUrl('https://127.0.0.1:8770')).toBe(false)
    expect(isLoopbackHttpUrl('not a url')).toBe(false)
  })
})

describe('ttsHealth', () => {
  it('true khi server trả 200', async () => {
    const f = vi.fn(async () => new Response('{"status":"ok"}', { status: 200 }))
    expect(await ttsHealth(f as unknown as typeof fetch, BASE)).toBe(true)
    expect(f.mock.calls[0][0]).toBe(`${BASE}/health`)
  })

  it('false khi server trả lỗi', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 500 }))
    expect(await ttsHealth(f as unknown as typeof fetch, BASE)).toBe(false)
  })

  it('false khi không kết nối được, không ném ra ngoài', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await ttsHealth(f as unknown as typeof fetch, BASE)).toBe(false)
  })
})

describe('synthesize', () => {
  it('POST đúng endpoint với giọng và steps đã chốt', async () => {
    const f = vi.fn(async () => wavResponse(new Uint8Array([82, 73, 70, 70])))
    await synthesize('xin chào', f as unknown as typeof fetch, BASE)

    expect(f.mock.calls[0][0]).toBe(`${BASE}/v1/audio/speech`)
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      input: 'xin chào',
      voice: 'Minh Quân',
      steps: 8,
    })
  })

  it('trả audio base64 và thời lượng chính xác từ header', async () => {
    // "RIFF" — the four bytes every WAV file starts with.
    const f = vi.fn(async () => wavResponse(new Uint8Array([82, 73, 70, 70]), 4.25))
    const res = await synthesize('xin chào', f as unknown as typeof fetch, BASE)

    expect(res.duration).toBe(4.25)
    expect(res.audio).toBe('UklGRg==')
  })

  it('mã hóa được buffer lớn mà không tràn call stack', async () => {
    // A 12-second sentence — the segmenter's ceiling — is about 576 KB of
    // 24 kHz 16-bit mono. String.fromCharCode(...bytes) throws
    // "Maximum call stack size exceeded" well below that, so the chunking
    // in toBase64 is load-bearing rather than tidiness.
    const big = new Uint8Array(600_000).fill(65)
    const f = vi.fn(async () => wavResponse(big, 12))
    const res = await synthesize('câu dài', f as unknown as typeof fetch, BASE)

    expect(res.audio.length).toBe(800_000)
    expect(atob(res.audio).length).toBe(600_000)
  })

  it('ném lỗi kèm status khi server trả lỗi', async () => {
    const f = vi.fn(async () => new Response('boom', { status: 500 }))
    await expect(synthesize('x', f as unknown as typeof fetch, BASE)).rejects.toThrow('500')
  })

  it('ném lỗi khi thiếu header thời lượng thay vì đoán', async () => {
    // The scheduler's whole stretch calculation is built on an exact
    // duration (spec 6.2). Guessing one here would produce speech that
    // drifts for reasons nothing downstream could explain.
    const f = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2]) as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        }),
    )
    await expect(synthesize('x', f as unknown as typeof fetch, BASE)).rejects.toThrow(
      'X-Audio-Duration',
    )
  })

  it('từ chối base URL không phải loopback mà không gọi mạng', async () => {
    const f = vi.fn(async () => wavResponse(new Uint8Array([1])))
    await expect(
      synthesize('x', f as unknown as typeof fetch, 'http://evil.example'),
    ).rejects.toThrow('loopback')
    expect(f).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/background/tts.test.ts
```

Expected: FAIL — `Failed to resolve import "./tts"`.

- [ ] **Step 3: Viết `extension/src/background/tts.ts`**

```ts
/**
 * The service worker's half of the TTS path.
 *
 * Spec 4.1 puts every network call in the service worker. Spec 8.3 says why
 * that matters here in particular: the local server answers `chrome-extension://`
 * origins only, and widening it so the content script could call the server
 * directly would hand every script running on the lecture page — Udemy's own
 * and its third parties' — a speech synthesiser on this machine.
 */

/**
 * Where the local VieNeu server listens.
 *
 * Hardcoded, and never read out of a message: a content script that has been
 * compromised must not get to choose which host the service worker calls.
 * The options page gains a field for this in M3 (spec 12), and that is when
 * `isLoopbackHttpUrl` stops being a formality and starts guarding real input.
 *
 * An `e2e` build points at the stub in scripts/serve-fixtures.mjs instead: the
 * real server holds port 8770 permanently under launchd, so an e2e run cannot
 * bind it. Same mechanism as the fixture origin in wxt.config.ts's
 * `build:manifestGenerated` hook, and `http://127.0.0.1/*` in host_permissions
 * covers both ports because match patterns ignore the port.
 */
export const TTS_BASE_URL =
  import.meta.env.MODE === 'e2e' ? 'http://127.0.0.1:5599' : 'http://127.0.0.1:8770'

export const TTS_VOICE = 'Minh Quân'
/** 8 beats 16: it sounds better and costs half the CPU (spec appendix A). */
export const TTS_STEPS = 8

const HEALTH_TIMEOUT_MS = 2_000
/** A 12-second sentence takes about 1.5s to synthesise once the model is
 *  warm, and about 6s on the very first call after the server starts. 30s is
 *  not a performance budget — it is the line past which something is wrong. */
const SPEECH_TIMEOUT_MS = 30_000

export interface SynthesisResult {
  /** WAV bytes, base64. chrome.runtime.sendMessage serialises with JSON, so
   *  an ArrayBuffer would arrive as `{}` — base64 is a constraint here, not
   *  a preference (spec 8.3). */
  audio: string
  /** Seconds, exact, from the server's X-Audio-Duration header. */
  duration: number
}

export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

function toBase64(bytes: Uint8Array): string {
  // btoa wants a binary string. String.fromCharCode(...bytes) spreads every
  // byte as an argument and throws "Maximum call stack size exceeded" on
  // anything this size, so the buffer is walked in chunks.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Whether the local server is answering. Never throws: "the server is not
 *  there" is the answer this question exists to give. */
export async function ttsHealth(
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = TTS_BASE_URL,
): Promise<boolean> {
  if (!isLoopbackHttpUrl(baseUrl)) return false
  try {
    const res = await fetchImpl(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function synthesize(
  text: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = TTS_BASE_URL,
): Promise<SynthesisResult> {
  if (!isLoopbackHttpUrl(baseUrl)) {
    throw new Error(`TTS base URL is not loopback: ${baseUrl}`)
  }

  const res = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: text, voice: TTS_VOICE, steps: TTS_STEPS }),
    signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`TTS request failed: ${res.status}`)

  const duration = Number(res.headers.get('X-Audio-Duration'))
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('TTS response is missing X-Audio-Duration')
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  return { audio: toBase64(bytes), duration }
}
```

- [ ] **Step 4: Chạy test, phải xanh**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/background/tts.test.ts
```

Expected: PASS, 12 test.

- [ ] **Step 5: Thêm `http://127.0.0.1/*` vào `host_permissions`**

Trong `extension/wxt.config.ts`, mảng `host_permissions` hiện có ba mục và **thiếu** loopback — bản M1 đã đánh rơi nó. Sửa thành:

```ts
    host_permissions: [
      'https://www.udemy.com/*',
      'https://*.udemycdn.com/*',
      'https://generativelanguage.googleapis.com/*',
      // Match patterns ignore the port, so this one entry covers the real
      // server on 8770 and the e2e stub on 5599. It is also what exempts
      // the service worker's fetch from CORS.
      'http://127.0.0.1/*',
    ],
```

- [ ] **Step 6: Nối hai message vào `extension/src/entrypoints/background.ts`**

Thêm vào khối import ở đầu file:

```ts
import { synthesize, ttsHealth } from '../background/tts'
```

Thêm hai interface request, ngay sau `FetchCaptionRequest`:

```ts
export interface TtsHealthRequest {
  type: 'tts-health'
}

export interface TtsSpeakRequest {
  type: 'tts-speak'
  text: string
}
```

Thêm hai interface response, ngay sau `TranslateResponse`:

```ts
export interface TtsHealthResponse {
  ok: boolean
}

/** Mirrors SynthesisResult on success. `error` is set instead on failure —
 *  the content script treats that as "this sentence gets no dub", not as
 *  "the lecture is over" (spec 10). */
export interface TtsSpeakResponse {
  audio?: string
  duration?: number
  error?: string
}
```

Mở rộng union `Request`:

```ts
type Request = TranslateRequest | FetchCaptionRequest | TtsHealthRequest | TtsSpeakRequest
```

Và thêm hai nhánh vào listener, ngay trước `return false` cuối cùng:

```ts
    if (msg.type === 'tts-health') {
      // ttsHealth never rejects, but the .catch is not dead weight: a
      // listener that returns true and then never calls sendResponse hangs
      // the caller until the port closes.
      ttsHealth()
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }))
      return true
    }

    if (msg.type === 'tts-speak') {
      if (typeof msg.text !== 'string' || msg.text.trim() === '') {
        sendResponse({ error: 'tts-speak requires non-empty text' })
        return true
      }
      synthesize(msg.text)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }))
      return true
    }
```

- [ ] **Step 7: Test hai nhánh mới trong `extension/src/entrypoints/__tests__/background.test.ts`**

Thêm vào cuối file:

```ts
describe('background: TTS bridge', () => {
  let listener: Listener
  let fetchMock: ReturnType<typeof vi.fn>

  /** Drives the listener the way chrome.runtime.sendMessage does, and
   *  resolves with whatever the handler passes to sendResponse. */
  const send = (msg: unknown): Promise<unknown> =>
    new Promise((resolve) => {
      listener(msg as Message, null, resolve)
    })

  beforeEach(async () => {
    vi.resetModules()
    stubDefineBackground()

    const addListener = vi.fn((l: Listener) => {
      listener = l
    })
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener } },
      storage: { local: { get: vi.fn(async () => ({})) } },
    })

    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await import('../background')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tts-health báo ok khi server trả lời', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await send({ type: 'tts-health' })).toEqual({ ok: true })
    expect(String(fetchMock.mock.calls[0][0])).toContain('127.0.0.1')
  })

  it('tts-health báo không ok khi không kết nối được', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await send({ type: 'tts-health' })).toEqual({ ok: false })
  })

  it('tts-speak trả audio và thời lượng', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([82, 73, 70, 70]) as unknown as BodyInit, {
        status: 200,
        headers: { 'X-Audio-Duration': '2.5' },
      }),
    )
    expect(await send({ type: 'tts-speak', text: 'xin chào' })).toEqual({
      audio: 'UklGRg==',
      duration: 2.5,
    })
  })

  it('tts-speak trả error thay vì treo khi server hỏng', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    const res = (await send({ type: 'tts-speak', text: 'xin chào' })) as { error?: string }
    expect(res.error).toContain('500')
  })

  it('tts-speak từ chối văn bản rỗng mà không gọi mạng', async () => {
    const res = (await send({ type: 'tts-speak', text: '   ' })) as { error?: string }
    expect(res.error).toContain('non-empty')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 8: Chạy đủ bộ test và typecheck**

```bash
cd /Users/anhdh/dubbing/extension && npm test && npm run typecheck
```

Expected: 165 test xanh (148 nền + 12 của `tts.test.ts` + 5 của bridge), typecheck sạch.

- [ ] **Step 9: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/src/background/tts.ts extension/src/background/tts.test.ts \
        extension/src/entrypoints/background.ts \
        extension/src/entrypoints/__tests__/background.test.ts \
        extension/wxt.config.ts
git commit -m "$(cat <<'MSG'
feat: call the local TTS server from the service worker

The base URL is a constant the service worker holds, never a field in the
message: the content script sends text and gets audio back, so a compromised
content script cannot pick the host. isLoopbackHttpUrl guards the constant
today and will guard real input when M3 makes it configurable.

Audio crosses as base64 because sendMessage serialises with JSON — an
ArrayBuffer arrives as {}. The chunked encoder is load-bearing: spreading a
576 KB buffer into String.fromCharCode overflows the stack.

Also restores http://127.0.0.1/* in host_permissions, dropped in M1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Trình phát audio và `VieNeuProvider`

**Files:**
- Create: `extension/src/providers/audio-player.ts`
- Test: `extension/src/providers/audio-player.test.ts`
- Create: `extension/src/providers/vieneu.ts`
- Test: `extension/src/providers/vieneu.test.ts`

**Interfaces:**
- Consumes: message `tts-health` và `tts-speak` từ Task 3
- Produces:
  - `AudioPlayer` = `{ play(rate: number): Promise<void>; cancel(): void }`
  - `createAudioPlayer(wavBase64: string, duration: number): AudioPlayer`
  - `class VieNeuProvider implements TTSProvider` với constructor `new VieNeuProvider(opts?: { send?, createPlayer? })` và một method thêm ngoài interface: `warmUp(): Promise<void>`. Task 5 bọc nó; Task 8 gọi `warmUp()`.

**Vì sao `HTMLAudioElement` chứ không phải Web Audio:** spec 8.3. `AudioBufferSourceNode.playbackRate` tăng tốc bằng cách đọc sample nhanh hơn nên đổi luôn cao độ; ở 1.4× giọng nghe như giọng chuột. `preservesPitch` của phần tử `<audio>` mặc định bật và cho đúng thứ công thức ở mục 6.2 vẫn luôn giả định.

- [ ] **Step 1: Viết test cho trình phát, `extension/src/providers/audio-player.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioPlayer } from './audio-player'

/** Stands in for HTMLAudioElement. Node has no `Audio`, and jsdom's
 *  HTMLMediaElement throws "Not implemented" on play() and never fires
 *  `ended`, so neither environment can exercise this for real — the e2e run
 *  in Task 9 is what proves the genuine element works. */
class FakeAudio {
  static last: FakeAudio | null = null
  playbackRate = 1
  preservesPitch = false
  paused = false
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playCalls = 0
  pauseCalls = 0
  playRejection: Error | null = null

  constructor(readonly src: string) {
    FakeAudio.last = this
  }

  play(): Promise<void> {
    this.playCalls++
    return this.playRejection ? Promise.reject(this.playRejection) : Promise.resolve()
  }

  pause(): void {
    this.pauseCalls++
    this.paused = true
  }
}

// "RIFF" in base64 — enough to stand in for a WAV body.
const WAV = 'UklGRg=='

describe('createAudioPlayer', () => {
  let revoke: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    FakeAudio.last = null
    vi.stubGlobal('Audio', FakeAudio)
    revoke = vi.spyOn(URL, 'revokeObjectURL')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('bật preservesPitch và đặt tốc độ được yêu cầu', async () => {
    const player = createAudioPlayer(WAV, 1)
    void player.play(1.3)
    await Promise.resolve()

    expect(FakeAudio.last?.preservesPitch).toBe(true)
    expect(FakeAudio.last?.playbackRate).toBe(1.3)
    expect(FakeAudio.last?.playCalls).toBe(1)
  })

  it('resolve khi audio phát xong, và trả lại blob URL', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    FakeAudio.last?.onended?.()
    await expect(done).resolves.toBeUndefined()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('cancel làm play reject bằng AbortError và dừng phần tử', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    player.cancel()

    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeAudio.last?.pauseCalls).toBe(1)
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('reject khi phần tử báo lỗi', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    FakeAudio.last?.onerror?.()
    await expect(done).rejects.toThrow('audio playback failed')
  })

  it('reject khi play() bị chính sách autoplay chặn', async () => {
    const player = createAudioPlayer(WAV, 1)
    const el = () => FakeAudio.last!
    // Constructed first so the rejection can be armed before play() runs.
    el().playRejection = new DOMException('blocked', 'NotAllowedError')

    await expect(player.play(1)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('tự kết thúc khi phần tử không bao giờ báo gì', async () => {
    // M1's Web Speech failure was exactly this: no onstart, no onend, no
    // onerror, just silence — and because nothing downstream had a deadline,
    // the scheduler would have waited for the rest of the lecture. The
    // duration is known exactly here, so waiting past it is provably wrong.
    vi.useFakeTimers()
    const player = createAudioPlayer(WAV, 4)
    const done = player.play(2)
    await Promise.resolve()

    // 4s of audio at rate 2 is 2s of wall clock, plus the 2s grace.
    vi.advanceTimersByTime(4_001)
    await expect(done).resolves.toBeUndefined()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('giải phóng blob URL đúng một lần dù cancel sau khi đã xong', async () => {
    const player = createAudioPlayer(WAV, 1)
    const done = player.play(1)
    await Promise.resolve()

    FakeAudio.last?.onended?.()
    await done
    player.cancel()

    expect(revoke).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Chạy test, phải đỏ**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/providers/audio-player.test.ts
```

Expected: FAIL — `Failed to resolve import "./audio-player"`.

- [ ] **Step 3: Viết `extension/src/providers/audio-player.ts`**

```ts
/** A prepared WAV, ready to play once. Not reusable: `play` is called at
 *  most once per instance, and the blob URL is released when it settles. */
export interface AudioPlayer {
  /** Resolves when playback finishes. Rejects with AbortError if cancelled. */
  play(rate: number): Promise<void>
  cancel(): void
}

/** How long past the audio's own length to wait before giving up on the
 *  element ever reporting anything. */
const WATCHDOG_GRACE_MS = 2_000

function toBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Wraps base64 WAV bytes in something the scheduler can play and cancel.
 *
 * `duration` is the exact length the server reported. It is not used to time
 * playback — the element does that — only to arm the watchdog below.
 */
export function createAudioPlayer(wavBase64: string, duration: number): AudioPlayer {
  const url = URL.createObjectURL(new Blob([toBytes(wavBase64)], { type: 'audio/wav' }))
  const audio = new Audio(url)
  // Speed up without raising the pitch. Default is already true in Chrome;
  // set explicitly because spec 6.2's rate clamp of 1.4 is only tolerable
  // with it on, and a silent default change would be hard to trace.
  audio.preservesPitch = true

  let settled = false
  let cancelled = false
  // Typed from the call rather than as `number`: "node" is in tsconfig's
  // `types`, so setTimeout resolves to Node's overload here, and this module
  // is unit-tested under the `node` environment where `window` does not exist.
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let rejectPlay: ((reason: unknown) => void) | null = null

  const release = (): void => {
    if (settled) return
    settled = true
    clearTimeout(watchdog)
    URL.revokeObjectURL(url)
  }

  return {
    play(rate: number): Promise<void> {
      if (cancelled) {
        return Promise.reject(new DOMException('cancelled', 'AbortError'))
      }
      audio.playbackRate = rate

      return new Promise<void>((resolve, reject) => {
        rejectPlay = reject

        const finish = (): void => {
          release()
          resolve()
        }
        const fail = (reason: unknown): void => {
          release()
          reject(reason)
        }

        audio.onended = finish
        audio.onerror = () => fail(new Error('audio playback failed'))

        // M1's Web Speech failure was an engine that fired no event at all,
        // and nothing downstream had a deadline, so the scheduler would have
        // waited out the lecture. Here the exact length is known, so waiting
        // past it is provably wrong rather than merely suspicious. Resolving
        // (not rejecting) is right: the slot is over either way, and the
        // scheduler's cleanup runs on both paths.
        watchdog = setTimeout(finish, (duration / rate) * 1000 + WATCHDOG_GRACE_MS)

        audio.play().catch(fail)
      })
    },

    cancel(): void {
      cancelled = true
      audio.pause()
      audio.onended = null
      audio.onerror = null
      release()
      rejectPlay?.(new DOMException('cancelled', 'AbortError'))
      rejectPlay = null
    },
  }
}
```

- [ ] **Step 4: Chạy test, phải xanh**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/providers/audio-player.test.ts
```

Expected: PASS, 7 test.

- [ ] **Step 5: Viết test cho provider, `extension/src/providers/vieneu.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AudioPlayer } from './audio-player'
import { VieNeuProvider } from './vieneu'

class FakePlayer implements AudioPlayer {
  static last: FakePlayer | null = null
  rateUsed: number | null = null
  cancelled = false
  private settle: (() => void) | null = null

  constructor(readonly wav: string) {
    FakePlayer.last = this
  }

  play(rate: number): Promise<void> {
    this.rateUsed = rate
    return new Promise<void>((resolve) => {
      this.settle = resolve
    })
  }

  finish(): void {
    this.settle?.()
    this.settle = null
  }

  cancel(): void {
    this.cancelled = true
  }
}

const OK_RESPONSE = { audio: 'UklGRg==', duration: 3.25 }

function setup(response: unknown = OK_RESPONSE) {
  FakePlayer.last = null
  const send = vi.fn(async () => response)
  const provider = new VieNeuProvider({
    send,
    createPlayer: (wav) => new FakePlayer(wav),
  })
  return { send, provider }
}

describe('VieNeuProvider.isAvailable', () => {
  it('true khi service worker báo server đang sống', async () => {
    const { send, provider } = setup({ ok: true })
    expect(await provider.isAvailable()).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'tts-health' })
  })

  it('false khi server không trả lời', async () => {
    const { provider } = setup({ ok: false })
    expect(await provider.isAvailable()).toBe(false)
  })

  it('false khi service worker bị huỷ giữa chừng', async () => {
    // sendMessage rejects — rather than resolving with an error payload —
    // when the worker is recycled or the port closes.
    const send = vi.fn(async () => {
      throw new Error('message port closed')
    })
    const provider = new VieNeuProvider({ send, createPlayer: (w) => new FakePlayer(w) })
    expect(await provider.isAvailable()).toBe(false)
  })
})

describe('VieNeuProvider.prepare', () => {
  it('gửi văn bản đi và lấy thời lượng chính xác từ server', async () => {
    const { send, provider } = setup()
    const u = await provider.prepare('xin chào', new AbortController().signal)

    expect(send).toHaveBeenCalledWith({ type: 'tts-speak', text: 'xin chào' })
    expect(u.duration).toBe(3.25)
    expect(FakePlayer.last?.wav).toBe('UklGRg==')
  })

  it('knowsDurationAhead là true — thời lượng do server báo, không phải ước lượng', () => {
    const { provider } = setup()
    expect(provider.knowsDurationAhead).toBe(true)
  })

  it('ném lỗi của server ra ngoài', async () => {
    const { provider } = setup({ error: 'TTS request failed: 500' })
    await expect(provider.prepare('x', new AbortController().signal)).rejects.toThrow('500')
  })

  it('ném lỗi khi phản hồi thiếu trường', async () => {
    const { provider } = setup({ audio: 'UklGRg==' })
    await expect(provider.prepare('x', new AbortController().signal)).rejects.toThrow('malformed')
  })

  it('không gọi service worker khi signal đã bị huỷ từ trước', async () => {
    const { send, provider } = setup()
    const controller = new AbortController()
    controller.abort()

    await expect(provider.prepare('x', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('huỷ trình phát khi signal tắt trong lúc đang chờ server', async () => {
    const controller = new AbortController()
    const send = vi.fn(async () => {
      controller.abort()
      return OK_RESPONSE
    })
    const provider = new VieNeuProvider({ send, createPlayer: (w) => new FakePlayer(w) })

    await expect(provider.prepare('x', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(FakePlayer.last?.cancelled).toBe(true)
  })
})

describe('VieNeuProvider utterance', () => {
  it('chuyển tốc độ xuống trình phát và resolve khi phát xong', async () => {
    const { provider } = setup()
    const u = await provider.prepare('xin chào', new AbortController().signal)

    const done = u.play(1.25)
    expect(FakePlayer.last?.rateUsed).toBe(1.25)

    FakePlayer.last?.finish()
    await expect(done).resolves.toBeUndefined()
  })

  it('cancel huỷ trình phát và làm play sau đó reject', async () => {
    const { provider } = setup()
    const u = await provider.prepare('xin chào', new AbortController().signal)

    u.cancel()
    expect(FakePlayer.last?.cancelled).toBe(true)
    await expect(u.play(1)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('VieNeuProvider.warmUp', () => {
  it('tổng hợp một câu rồi vứt đi', async () => {
    const { send, provider } = setup()
    await provider.warmUp()

    expect(send).toHaveBeenCalledWith({ type: 'tts-speak', text: 'Xin chào.' })
    expect(FakePlayer.last?.cancelled).toBe(true)
  })

  it('nuốt lỗi — làm nóng hỏng không được làm hỏng việc gắn vào bài giảng', async () => {
    const { provider } = setup({ error: 'TTS request failed: 500' })
    await expect(provider.warmUp()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 6: Chạy test, phải đỏ**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/providers/vieneu.test.ts
```

Expected: FAIL — `Failed to resolve import "./vieneu"`.

- [ ] **Step 7: Viết `extension/src/providers/vieneu.ts`**

```ts
import type { TTSProvider, Utterance } from '../core/types'
import { createAudioPlayer, type AudioPlayer } from './audio-player'

type SendMessage = (message: unknown) => Promise<unknown>

export interface VieNeuOptions {
  /** Defaults to chrome.runtime.sendMessage. Injected so the provider is
   *  testable without an extension runtime. */
  send?: SendMessage
  createPlayer?: (wavBase64: string, duration: number) => AudioPlayer
}

interface SpeakReply {
  audio?: string
  duration?: number
  error?: string
}

const abortError = (): DOMException => new DOMException('aborted', 'AbortError')

/**
 * Speaks through the local VieNeu server. The synthesis itself happens in
 * the service worker (spec 4.1, 8.3); this side sends the text, receives
 * base64 WAV and an exact duration, and owns playback because playback has
 * to sit next to the video.
 */
export class VieNeuProvider implements TTSProvider {
  readonly name = 'vieneu'
  /** The server reports the exact length in X-Audio-Duration, so the
   *  scheduler never has to estimate — unlike Web Speech. */
  readonly knowsDurationAhead = true

  private readonly send: SendMessage
  private readonly createPlayer: (wavBase64: string, duration: number) => AudioPlayer

  constructor(opts: VieNeuOptions = {}) {
    this.send = opts.send ?? ((message) => chrome.runtime.sendMessage(message))
    this.createPlayer = opts.createPlayer ?? createAudioPlayer
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = (await this.send({ type: 'tts-health' })) as { ok?: boolean } | undefined
      return res?.ok === true
    } catch {
      // sendMessage rejects when the service worker is recycled mid-request
      // or the port closes. Unreachable is unavailable.
      return false
    }
  }

  /**
   * Synthesises one throwaway sentence so the server's start-up cost is paid
   * before a real sentence needs it: 4.3s to load the model, then about 1.8s
   * for the first inference regardless of length — roughly six seconds that
   * would otherwise land on the first sentence of the lecture.
   *
   * Best-effort. A failure here is not a reason to stop attaching: the real
   * availability answer came from isAvailable().
   */
  async warmUp(): Promise<void> {
    try {
      const utterance = await this.prepare('Xin chào.', new AbortController().signal)
      utterance.cancel()
    } catch {
      // Intentionally swallowed — see above.
    }
  }

  async prepare(text: string, signal: AbortSignal): Promise<Utterance> {
    if (signal.aborted) throw abortError()

    const res = (await this.send({ type: 'tts-speak', text })) as SpeakReply | undefined
    if (res?.error) throw new Error(res.error)
    if (typeof res?.audio !== 'string' || typeof res?.duration !== 'number') {
      throw new Error('TTS reply is malformed')
    }

    const player = this.createPlayer(res.audio, res.duration)

    // The round trip takes long enough for a seek to land inside it. Building
    // the player already allocated a blob URL, so it has to be released
    // rather than simply dropped.
    if (signal.aborted) {
      player.cancel()
      throw abortError()
    }

    let cancelled = false
    return {
      duration: res.duration,

      play(rate: number): Promise<void> {
        if (cancelled || signal.aborted) return Promise.reject(abortError())
        return player.play(rate)
      },

      cancel(): void {
        cancelled = true
        player.cancel()
      },
    }
  }
}
```

- [ ] **Step 8: Chạy đủ bộ test và typecheck**

```bash
cd /Users/anhdh/dubbing/extension && npm test && npm run typecheck
```

Expected: 185 test xanh (165 + 7 + 13), typecheck sạch.

- [ ] **Step 9: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/src/providers/audio-player.ts extension/src/providers/audio-player.test.ts \
        extension/src/providers/vieneu.ts extension/src/providers/vieneu.test.ts
git commit -m "$(cat <<'MSG'
feat: speak through the local VieNeu server

Playback uses HTMLAudioElement with preservesPitch rather than Web Audio:
AudioBufferSourceNode speeds up by reading samples faster, so the 1.4x rate
ceiling spec 6.2 assumes would come out as a chipmunk.

The player carries a watchdog armed from the server's exact duration. M1's
Web Speech failure was an engine that fired no event at all, and nothing
downstream had a deadline — the scheduler would have waited out the lecture.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `FallbackProvider`

**Files:**
- Create: `extension/src/core/fallback.ts`
- Test: `extension/src/core/fallback.test.ts`

**Interfaces:**
- Consumes: bất kỳ hai `TTSProvider` nào
- Produces: `class FallbackProvider implements TTSProvider`, constructor `(primary: TTSProvider, backup: TTSProvider, opts?: FallbackOptions)`, thêm getter `status: ProviderStatus` (`'primary' | 'fallback'`). `FallbackOptions = { cooldownMs?: number; now?: () => number; onStatusChange?: (status: ProviderStatus, reason: string) => void }`. Task 8 dựng nó.

**Vì sao là một provider chứ không phải một nhánh if trong scheduler:** spec 8.4. Scheduler đã là phần khó nhất trong hệ; thêm vào đó khái niệm "engine nào đang sống" sẽ làm nó khó hơn mà không cần thiết. Ở đây toàn bộ việc chuyển đổi nằm trong `src/core/` nên test được không cần trình duyệt.

- [ ] **Step 1: Viết test trước, `extension/src/core/fallback.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { FallbackProvider, type ProviderStatus } from './fallback'
import type { TTSProvider, Utterance } from './types'

const utterance = (duration: number): Utterance => ({
  duration,
  play: async () => {},
  cancel: () => {},
})

/** A provider whose availability and failure mode the test controls. */
class ControllableTTS implements TTSProvider {
  available = true
  failWith: Error | null = null
  prepareCalls = 0

  constructor(
    readonly name: string,
    readonly knowsDurationAhead: boolean,
    private readonly duration: number,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async prepare(): Promise<Utterance> {
    this.prepareCalls++
    if (this.failWith) throw this.failWith
    return utterance(this.duration)
  }
}

function setup(cooldownMs = 30_000) {
  const primary = new ControllableTTS('vieneu', true, 1)
  const backup = new ControllableTTS('web-speech', false, 2)
  let clock = 0
  const changes: [ProviderStatus, string][] = []

  const provider = new FallbackProvider(primary, backup, {
    cooldownMs,
    now: () => clock,
    onStatusChange: (status, reason) => changes.push([status, reason]),
  })

  return { primary, backup, provider, changes, tick: (ms: number) => (clock += ms) }
}

const signal = (): AbortSignal => new AbortController().signal

describe('FallbackProvider.isAvailable', () => {
  it('dùng primary khi nó sống, và không hỏi backup', async () => {
    const { primary, backup, provider, changes } = setup()
    backup.isAvailable = vi.fn(async () => true)

    expect(await provider.isAvailable()).toBe(true)
    expect(provider.status).toBe('primary')
    expect(backup.isAvailable).not.toHaveBeenCalled()
    expect(changes).toEqual([])
    expect(primary.prepareCalls).toBe(0)
  })

  it('chuyển sang backup khi primary chết, và nói ra một lần', async () => {
    const { primary, provider, changes } = setup()
    primary.available = false

    expect(await provider.isAvailable()).toBe(true)
    expect(provider.status).toBe('fallback')
    expect(changes).toHaveLength(1)
    expect(changes[0][0]).toBe('fallback')
  })

  it('false khi cả hai đều không dùng được', async () => {
    const { primary, backup, provider } = setup()
    primary.available = false
    backup.available = false

    expect(await provider.isAvailable()).toBe(false)
  })
})

describe('FallbackProvider.prepare', () => {
  it('trả utterance của primary khi mọi thứ bình thường', async () => {
    const { provider, backup } = setup()
    const u = await provider.prepare('xin chào', signal())

    expect(u.duration).toBe(1)
    expect(backup.prepareCalls).toBe(0)
  })

  it('rơi sang backup khi primary ném lỗi, và nói ra', async () => {
    const { primary, provider, changes } = setup()
    primary.failWith = new Error('TTS request failed: 500')

    const u = await provider.prepare('xin chào', signal())

    expect(u.duration).toBe(2)
    expect(provider.status).toBe('fallback')
    expect(changes).toEqual([['fallback', 'TTS request failed: 500']])
  })

  it('không thử lại primary trong thời gian cooldown', async () => {
    const { primary, backup, provider, tick } = setup(30_000)
    primary.failWith = new Error('boom')

    await provider.prepare('một', signal())
    expect(primary.prepareCalls).toBe(1)

    tick(29_000)
    await provider.prepare('hai', signal())
    await provider.prepare('ba', signal())

    // Still 1: every sentence in the cooldown window went straight to the
    // backup. Retrying a dead server once per sentence would add its
    // timeout to every single one.
    expect(primary.prepareCalls).toBe(1)
    expect(backup.prepareCalls).toBe(3)
  })

  it('thử lại primary sau cooldown và quay về nó khi nó sống lại', async () => {
    const { primary, provider, changes, tick } = setup(30_000)
    primary.failWith = new Error('boom')
    await provider.prepare('một', signal())

    tick(30_000)
    primary.failWith = null
    const u = await provider.prepare('hai', signal())

    expect(u.duration).toBe(1)
    expect(provider.status).toBe('primary')
    expect(changes.map((c) => c[0])).toEqual(['fallback', 'primary'])
  })

  it('chỉ nói khi trạng thái thật sự đổi, không nói mỗi câu', async () => {
    const { primary, provider, changes } = setup()
    primary.failWith = new Error('boom')

    await provider.prepare('một', signal())
    await provider.prepare('hai', signal())
    await provider.prepare('ba', signal())

    expect(changes).toHaveLength(1)
  })

  it('ném AbortError ra ngoài mà không kết tội primary', async () => {
    // A seek cancels the sentence being prepared. That is the viewer moving,
    // not the server breaking — treating it as a failure would drop a
    // working engine every time someone scrubs the timeline.
    const { primary, backup, provider, changes } = setup()
    primary.failWith = new DOMException('aborted', 'AbortError')

    await expect(provider.prepare('xin chào', signal())).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(backup.prepareCalls).toBe(0)
    expect(provider.status).toBe('primary')
    expect(changes).toEqual([])
  })
})

describe('FallbackProvider.knowsDurationAhead', () => {
  it('theo engine đang hoạt động', async () => {
    const { primary, provider } = setup()
    expect(provider.knowsDurationAhead).toBe(true)

    primary.failWith = new Error('boom')
    await provider.prepare('xin chào', signal())

    expect(provider.knowsDurationAhead).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test, phải đỏ**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/core/fallback.test.ts
```

Expected: FAIL — `Failed to resolve import "./fallback"`.

- [ ] **Step 3: Viết `extension/src/core/fallback.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test và typecheck**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/core/fallback.test.ts && npm test && npm run typecheck
```

Expected: 195 test xanh (185 + 10), typecheck sạch.

- [ ] **Step 5: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/src/core/fallback.ts extension/src/core/fallback.test.ts
git commit -m "$(cat <<'MSG'
feat: switch engines behind a single TTSProvider

The scheduler is the hardest part of this system already; teaching it which
of two engines is currently alive would make it harder for no gain. All the
switching lives in one pure unit instead.

An AbortError from the primary is rethrown rather than counted as a failure:
a seek cancels the sentence being prepared, and treating that as a broken
server would drop a working engine every time someone scrubs the timeline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Chọn đúng giọng Web Speech (nợ từ M1)

**Files:**
- Modify: `extension/src/providers/web-speech.ts`
- Modify: `extension/src/providers/web-speech.test.ts`

**Interfaces:**
- Consumes: không có
- Produces: không đổi chữ ký nào — chỉ đổi giọng được chọn.

**Bối cảnh:** `docs/superpowers/2026-09-20-m1-verification.md`, mục "Việc còn lại". Comment trong `web-speech.ts` ghi rằng macOS chỉ phơi ra một giọng Việt và bản Enhanced không với tới được qua Web Speech. Quan sát thật cho thấy `getVoices()` trả về **hai** giọng: `Linh` và `Linh (Nâng cao)`. Vì `voice()` dùng `find()` nên nó đang lấy giọng thường — giọng kém hơn — và comment thì nói ngược lại sự thật, nên không ai đọc code sẽ nghĩ tới việc sửa.

Đây là engine dự phòng, không phải engine chính. Sửa nó vẫn đáng: nó là thứ duy nhất còn lại khi server không chạy.

- [ ] **Step 1: Thêm hai test vào `extension/src/providers/web-speech.test.ts`**

`installFakeSpeech` hiện hardcode một giọng. Cho nó nhận danh sách giọng:

```ts
function installFakeSpeech(
  voices: { lang: string; name: string; default?: boolean }[] = [
    { lang: 'vi-VN', name: 'Linh', default: true },
  ],
) {
  const spoken: FakeSpeechSynthesisUtterance[] = []
  const synth = {
    speak: vi.fn((u: FakeSpeechSynthesisUtterance) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: () => voices,
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
  return { synth, spoken }
}
```

Rồi thêm vào cuối `describe('WebSpeechProvider', ...)`:

```ts
  it('ưu tiên giọng nâng cao khi macOS phơi ra cả hai', async () => {
    // Observed on this machine during the M1 verification run: getVoices()
    // returns both "Linh" and "Linh (Nâng cao)". find() took the first,
    // which is the worse one.
    const { spoken } = installFakeSpeech([
      { lang: 'vi-VN', name: 'Linh', default: true },
      { lang: 'vi-VN', name: 'Linh (Nâng cao)' },
    ])
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    void u.play(1)

    expect((spoken[0].voice as { name: string }).name).toBe('Linh (Nâng cao)')
  })

  it('dùng giọng thường khi chỉ có nó', async () => {
    const { spoken } = installFakeSpeech([{ lang: 'vi-VN', name: 'Linh', default: true }])
    const u = await new WebSpeechProvider().prepare('xin chào', new AbortController().signal)
    void u.play(1)

    expect((spoken[0].voice as { name: string }).name).toBe('Linh')
  })
```

- [ ] **Step 2: Chạy test, cái đầu phải đỏ**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/providers/web-speech.test.ts
```

Expected: FAIL đúng một test — `expected 'Linh' to be 'Linh (Nâng cao)'`. Test thứ hai xanh ngay, đúng như nó phải thế.

- [ ] **Step 3: Sửa `voice()` trong `extension/src/providers/web-speech.ts`**

```ts
/** macOS ships the enhanced Vietnamese voice under a localised name —
 *  "Linh (Enhanced)" in English, "Linh (Nâng cao)" in Vietnamese — so the
 *  qualifier has to be matched in both. */
const ENHANCED_VOICE = /enhanced|premium|nâng cao/i

  private voice(): SpeechSynthesisVoice | undefined {
    if (typeof speechSynthesis === 'undefined') return undefined
    const vietnamese = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('vi'))
    return vietnamese.find((v) => ENHANCED_VOICE.test(v.name)) ?? vietnamese[0]
  }
```

Đặt hằng `ENHANCED_VOICE` cạnh `const LANG = 'vi-VN'` ở đầu file, không phải bên trong class.

- [ ] **Step 4: Sửa comment sai ở đầu class**

Thay hai dòng cuối của docblock trên `export class WebSpeechProvider`:

```
 * On macOS this reaches exactly one Vietnamese voice ("Linh"); the Enhanced
 * build Apple ships is not exposed to the Web Speech API.
```

bằng:

```
 * On macOS this reaches two Vietnamese voices — "Linh" and its enhanced
 * build, whose name is localised — and prefers the enhanced one. An earlier
 * comment here claimed only the plain voice was exposed; the M1 verification
 * run showed otherwise (docs/superpowers/2026-09-20-m1-verification.md).
 *
 * Note that on this machine speechSynthesis.speak() does nothing at all: no
 * onstart, no onend, no onerror. That is a Chrome/macOS fault, not this
 * code's, and it is why the local server is the real engine rather than an
 * upgrade.
```

- [ ] **Step 5: Chạy đủ bộ test và typecheck**

```bash
cd /Users/anhdh/dubbing/extension && npm test && npm run typecheck
```

Expected: 197 test xanh, typecheck sạch.

- [ ] **Step 6: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/src/providers/web-speech.ts extension/src/providers/web-speech.test.ts
git commit -m "$(cat <<'MSG'
fix: prefer the enhanced Vietnamese voice in the Web Speech fallback

getVoices() returns both "Linh" and "Linh (Nâng cao)" on this machine, and
find() was taking the first — the worse one. The comment above it asserted
the enhanced build was not exposed at all, so nobody reading the code would
have thought to look.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Scheduler chuẩn bị trước một câu

**Files:**
- Modify: `extension/src/core/testing/fakes.ts`
- Modify: `extension/src/core/scheduler.ts`
- Modify: `extension/src/core/scheduler.test.ts`

**Interfaces:**
- Consumes: `TTSProvider` như cũ
- Produces: không đổi API công khai của `Scheduler`. Task 8 không phải sửa gì vì việc này.

**Đây là thay đổi rủi ro nhất của M2.** Scheduler là nơi bug trú ngụ (spec mục 11) và nó đã có ba cơ chế huỷ đan vào nhau: `generation`, `starting`, `preparing`. Phần chuẩn bị trước phải tuân theo cả ba. Đọc spec mục 6.5 trước khi viết dòng nào.

- [ ] **Step 1: Cho `FakeTTS` ghi lại văn bản nó được yêu cầu đọc**

Trong `extension/src/core/testing/fakes.ts`, thêm một trường vào `FakeTTS` và ghi vào nó trong `prepare`:

```ts
export class FakeTTS implements TTSProvider {
  readonly name = 'fake'
  readonly knowsDurationAhead = true
  readonly prepared: FakeUtterance[] = []
  /** Every text prepare() was asked for, in order. Counting utterances is
   *  not enough once the scheduler prepares ahead: the question becomes
   *  *which* sentence was prepared, not how many. */
  readonly texts: string[] = []

  constructor(
    private durationFor: (text: string) => number = () => 1,
    private prepareDelayMs = 0,
  ) {}

  async isAvailable(): Promise<boolean> {
    return true
  }

  async prepare(text: string): Promise<Utterance> {
    this.texts.push(text)
    if (this.prepareDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.prepareDelayMs))
    }
    const u = new FakeUtterance(this.durationFor(text))
    this.prepared.push(u)
    return u
  }

  get last(): FakeUtterance | undefined {
    return this.prepared[this.prepared.length - 1]
  }
}
```

Giữ nguyên mọi thứ khác trong file.

- [ ] **Step 2: Sửa các test hiện có để đo đúng thứ chúng muốn đo**

Sáu test hiện có dùng `tts.prepared.length` để trả lời câu hỏi "có đọc không". Ở M1 hai thứ đó trùng nhau, vì scheduler chỉ tổng hợp đúng lúc nó định đọc. Từ task này thì không còn trùng: `prepared` đếm cả phần chuẩn bị cho khung thời gian chưa tới. Phép đo cũ sẽ sai — không phải vì tính năng mới sai, mà vì nó vốn là phép đo gián tiếp và giờ khoảng cách giữa nó với thứ nó đại diện mới lộ ra.

**Làm bước này trước khi đụng vào `scheduler.ts`, và chứng minh nó vẫn xanh.** Làm ngược lại thì không ai phân biệt được "sửa phép đo" với "nới test cho vừa code".

Mở rộng dòng import sẵn có và thêm hai helper ngay sau `function setup(...)`:

```ts
import { FakeTTS, FakeUtterance, FakeVideo } from './testing/fakes'
import type { Segment, TTSProvider } from './types'
```

```ts
/** Utterances the scheduler actually spoke. Once it prepares a sentence
 *  ahead of its slot, `tts.prepared.length` stops answering "did it speak?"
 *  — it also counts work done for a slot that has not arrived yet. */
const played = (tts: FakeTTS): FakeUtterance[] => tts.prepared.filter((u) => u.played)

/** The utterance being spoken, as opposed to one merely prepared. */
const spoken = (tts: FakeTTS): FakeUtterance | undefined => tts.prepared.find((u) => u.played)
```

Rồi thay **mọi lần xuất hiện** của bốn dạng sau trong file. Không đổi tên test, không đổi phần dựng cảnh:

| Cũ | Mới |
|---|---|
| `expect(tts.prepared).toHaveLength(N)` | `expect(played(tts)).toHaveLength(N)` |
| `tts.last!.finish()` | `spoken(tts)!.finish()` |
| `expect(tts.last?.rateUsed)` | `expect(spoken(tts)?.rateUsed)` |
| `expect(tts.last?.cancelled).toBe(true)` | `expect(spoken(tts)?.cancelled).toBe(true)` |
| `expect(tts.last?.played).toBe(true)` | `expect(spoken(tts)).toBeDefined()` |

Hai chỗ phải sửa riêng vì chúng không khớp dạng nào ở trên:

Trong `'chưa đọc gì khi video chưa tới segment đầu'`, thêm một khẳng định nữa sau dòng đã thay — từ task này trở đi, "chưa đọc gì" phải được chứng minh bằng thứ người xem nghe thấy, không phải bằng việc đã tổng hợp hay chưa:

```ts
    expect(played(tts)).toHaveLength(0)
    expect(video.volume).toBeCloseTo(1)
```

Trong `'tua trong lúc đang chuẩn bị thì bỏ câu đó'`, thay hai dòng:

```ts
    expect(tts.last?.played).toBe(false)
    expect(tts.last?.cancelled).toBe(true)
```

bằng:

```ts
    expect(played(tts)).toHaveLength(0)
    expect(tts.prepared.every((u) => u.cancelled)).toBe(true)
```

- [ ] **Step 3: Chạy test, phải vẫn xanh nguyên**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/core/scheduler.test.ts
```

Expected: PASS, 19 test. **Nếu có bất kỳ test nào đỏ ở đây thì dừng lại và báo cáo** — chưa có hành vi nào thay đổi, nên một lần đỏ ở bước này nghĩa là phép thay thế đã làm sai chứ không phải scheduler sai.

- [ ] **Step 4: Viết test cho phần chuẩn bị trước**

Thêm vào cuối `extension/src/core/scheduler.test.ts` một `describe` mới:

```ts
describe('Scheduler: chuẩn bị trước', () => {
  it('chuẩn bị câu sắp tới trước khi video chạm nó', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()

    // Nothing is being spoken yet — this prepare exists only because the
    // sentence starts within the lookahead window.
    expect(tts.texts).toEqual(['câu một'])
    expect(tts.prepared[0].played).toBe(false)
  })

  it('dùng lại câu đã chuẩn bị thay vì tổng hợp lại', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()

    video.currentTime = 1.0
    await scheduler.tick()

    // Still one prepare, and it is the one that got played. Without the
    // prefetch path this would be two, and the second would start 0.8s into
    // the slot on the real provider.
    expect(tts.texts).toEqual(['câu một'])
    expect(tts.prepared[0].played).toBe(true)
  })

  it('chuẩn bị câu kế tiếp trong lúc đang đọc câu hiện tại', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 1.0
    await scheduler.tick()

    video.currentTime = 2.0
    await scheduler.tick()

    expect(tts.texts).toContain('câu hai')
  })

  it('không chuẩn bị câu còn quá xa', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.setSegments([
      { id: 0, start: 1, end: 5, srcText: 'a', viText: 'câu một', status: 'ready' },
      { id: 1, start: 30, end: 34, srcText: 'b', viText: 'câu hai', status: 'ready' },
    ])
    video.currentTime = 1.0
    await scheduler.tick()

    // 29 seconds out, well past PREFETCH_LEAD. Preparing it now would be
    // thrown away by the first seek and would hold the one prefetch slot
    // against the sentence that actually needs it.
    expect(tts.texts).toEqual(['câu một'])
  })

  it('không chuẩn bị câu chưa dịch xong', async () => {
    const { video, tts, scheduler } = setup()
    scheduler.setSegments([
      { id: 0, start: 1, end: 5, srcText: 'a', viText: 'câu một', status: 'ready' },
      { id: 1, start: 6, end: 10, srcText: 'b', status: 'pending' },
    ])
    video.currentTime = 1.0
    await scheduler.tick()

    expect(tts.texts).toEqual(['câu một'])
  })

  it('huỷ phần đã chuẩn bị khi người xem tua', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()
    expect(tts.prepared).toHaveLength(1)

    scheduler.onSeek()

    // Cancelled, not merely forgotten: the real provider holds a blob URL
    // that leaks if nobody releases it.
    await vi.waitFor(() => expect(tts.prepared[0].cancelled).toBe(true))
  })

  it('bỏ phần đã chuẩn bị cho câu bị bỏ qua vì vào quá muộn', async () => {
    const { video, tts, scheduler } = setup()
    video.currentTime = 0.5
    await scheduler.tick()

    // 3.9s into a slot that started at 1 — past MAX_LATENESS, so tick()
    // skips it and the prepared sentence will never be consumed.
    video.currentTime = 4.9
    await scheduler.tick()
    await scheduler.tick()

    await vi.waitFor(() => expect(tts.prepared[0].cancelled).toBe(true))
    expect(tts.texts).toContain('câu hai')
  })

  it('vẫn đọc được khi việc chuẩn bị trước thất bại', async () => {
    const video = new FakeVideo()
    const made: FakeUtterance[] = []
    let calls = 0
    const flaky: TTSProvider = {
      name: 'flaky',
      knowsDurationAhead: true,
      isAvailable: async () => true,
      prepare: async () => {
        calls++
        if (calls === 1) throw new Error('synthesis failed')
        const u = new FakeUtterance(2)
        made.push(u)
        return u
      },
    }
    const scheduler = new Scheduler({ video, provider: flaky })
    scheduler.setSegments(segs())

    video.currentTime = 0.5
    await scheduler.tick()
    await vi.waitFor(() => expect(calls).toBe(1))

    video.currentTime = 1.0
    await scheduler.tick()

    // A failed prefetch must not poison the slot: speak() synthesises live
    // instead, exactly as it did before this feature existed.
    await vi.waitFor(() => expect(made.some((u) => u.played)).toBe(true))
  })

  it('để nguyên âm lượng gốc khi tổng hợp thất bại hẳn', async () => {
    // Spec 10: a segment whose synthesis fails is skipped and the original
    // audio plays at full volume for that slot. Unchanged since M1, but
    // untested until now, and take() is the code that has to keep it true.
    const video = new FakeVideo()
    const broken: TTSProvider = {
      name: 'broken',
      knowsDurationAhead: true,
      isAvailable: async () => true,
      prepare: async () => {
        throw new Error('synthesis failed')
      },
    }
    const scheduler = new Scheduler({ video, provider: broken })
    scheduler.setSegments(segs())

    video.currentTime = 1.0
    await scheduler.tick()

    expect(video.volume).toBeCloseTo(1)
    expect(video.playbackRate).toBeCloseTo(1)
  })
})
```

- [ ] **Step 5: Chạy test, phải đỏ**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/core/scheduler.test.ts
```

Expected: FAIL ở chín test mới. Test đầu tiên báo `expected [] to deeply equal [ 'câu một' ]` — chưa có gì được chuẩn bị trước cả. **Mười chín test cũ vẫn phải xanh**; nếu một test cũ đỏ ở bước này thì bạn đã sửa nhầm `fakes.ts` ở Step 1.

- [ ] **Step 6: Thêm phần chuẩn bị trước vào `extension/src/core/scheduler.ts`**

Ngay dưới hằng `MAX_LATENESS`, thêm:

```ts
/** How far ahead of the playhead a sentence may be synthesised, in seconds
 *  of video time. Spec 6.5: exactly one sentence is held at a time, so this
 *  only decides how early that one may start. */
const PREFETCH_LEAD = 10

/** A sentence being synthesised ahead of its slot. */
interface Prefetched {
  id: number
  controller: AbortController
  promise: Promise<Utterance>
}
```

Thêm một trường vào class, cạnh `preparing`:

```ts
  /** The one sentence prepared ahead of its slot, if any (spec 6.5). */
  private prefetched: Prefetched | null = null
```

Sửa `tick()` — hai dòng đầu, phần còn lại giữ nguyên:

```ts
  async tick(): Promise<void> {
    if (this.stopped || this.video.paused) return

    // Ahead of the guards below on purpose: the time to prepare the next
    // sentence is precisely while the current one is being spoken.
    this.maybePrefetch()

    if (this.starting || this.speaking !== null) return

    const now = this.video.currentTime
    // ... phần còn lại của tick() không đổi ...
```

Thêm hai method private, đặt ngay trước `speak()`:

```ts
  private maybePrefetch(): void {
    const held = this.prefetched
    if (held !== null) {
      // tick() marks a segment spoken when it skips one — too late, or not
      // translated yet — and a prefetch for such a segment will never be
      // consumed by anything.
      if (this.spoken.has(held.id)) this.discardPrefetch()
      else return
    }

    const now = this.video.currentTime
    const next = this.segments.find(
      (s): s is Segment & { viText: string } =>
        isReady(s) && !this.spoken.has(s.id) && s.start > now && s.start - now <= PREFETCH_LEAD,
    )
    if (next === undefined) return

    const generation = this.generation
    const controller = new AbortController()
    const entry: Prefetched = {
      id: next.id,
      controller,
      promise: this.provider.prepare(next.viText, controller.signal),
    }
    this.prefetched = entry

    entry.promise.then(
      (utterance) => {
        // Consumed by speak(), or already discarded — either way not ours.
        if (this.prefetched !== entry) return
        if (generation !== this.generation) {
          // A seek landed while this was in flight. It belongs to a position
          // the viewer has left, and the real provider is holding a blob URL
          // that leaks unless somebody releases it.
          this.prefetched = null
          utterance.cancel()
        }
      },
      () => {
        // Synthesis failed. Forget it rather than remembering the failure:
        // speak() will try live when the slot arrives, and FallbackProvider
        // has already recorded what this means for engine health.
        if (this.prefetched === entry) this.prefetched = null
      },
    )
  }

  private discardPrefetch(): void {
    const held = this.prefetched
    if (held === null) return
    this.prefetched = null
    held.controller.abort()
    held.promise.then(
      (utterance) => utterance.cancel(),
      () => {
        // Already failed; nothing to release.
      },
    )
  }
```

Thay phần đầu của `speak()` — khối `this.preparing = controller` cho tới hết `finally` — bằng một lời gọi tới một helper mới:

```ts
  private async speak(
    segment: Segment & { viText: string },
    next: Segment | undefined,
    now: number,
  ): Promise<void> {
    const generation = this.generation
    const utterance = await this.take(segment)
    if (utterance === null) return
```

và thêm helper, đặt ngay sau `speak()`:

```ts
  /** The utterance for this segment: the one prepared ahead if it is the
   *  right one, otherwise a fresh synthesis. Null when preparation failed —
   *  the slot then plays the original audio at full volume (spec 10). */
  private async take(segment: Segment & { viText: string }): Promise<Utterance | null> {
    const held = this.prefetched
    const usable = held !== null && held.id === segment.id ? held : null
    if (usable !== null) this.prefetched = null

    // A prefetch for a *different* segment is left alone: find() always
    // returns the nearest upcoming sentence, so it is the next one, not a
    // stale one.
    const controller = usable?.controller ?? new AbortController()
    const promise = usable?.promise ?? this.provider.prepare(segment.viText, controller.signal)

    this.preparing = controller
    try {
      return await promise
    } catch {
      return null
    } finally {
      if (this.preparing === controller) this.preparing = null
    }
  }
```

Phần còn lại của `speak()` — từ `if (generation !== this.generation)` trở đi — giữ nguyên **trừ** một chỗ: nó hiện khai báo `let utterance: Utterance` rồi gán trong `try`. Bỏ khai báo đó đi, `const utterance` ở trên đã thay thế.

Cuối cùng, cho `cancelCurrent()` dọn cả phần chuẩn bị trước:

```ts
  private cancelCurrent(): void {
    this.preparing?.abort()
    // Pausing throws away a prepared sentence too, so resuming re-synthesises
    // it — about half a second on the real provider. Keeping it across a
    // pause would mean tracking whether the viewer resumed at the same place,
    // which is not worth half a second.
    this.discardPrefetch()
    if (this.speaking === null) return
    this.speaking.controller.abort()
    this.speaking.utterance.cancel()
    this.restore()
  }
```

- [ ] **Step 7: Chạy test scheduler, phải xanh**

```bash
cd /Users/anhdh/dubbing/extension && npx vitest run src/core/scheduler.test.ts
```

Expected: PASS, 28 test (19 cũ + 9 mới). Mười chín test cũ xanh là điều kiện bắt buộc: chúng là bằng chứng phần chuẩn bị trước không làm hỏng việc huỷ, ducking hay co giãn tốc độ.

- [ ] **Step 8: Chạy đủ bộ test và typecheck**

```bash
cd /Users/anhdh/dubbing/extension && npm test && npm run typecheck
```

Expected: 206 test xanh, typecheck sạch.

- [ ] **Step 9: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/src/core/scheduler.ts extension/src/core/scheduler.test.ts \
        extension/src/core/testing/fakes.ts
git commit -m "$(cat <<'MSG'
feat: synthesise one sentence ahead of the playhead

M1 called prepare() at the moment a sentence started, which was free with
Web Speech and is not with a real engine: about 0.8s per sentence, every
sentence. Because computeStretch budgets from max(segment.start, now), that
delay turns straight into a higher speaking rate and a slowed-down video —
a steady defect rather than an occasional one.

Exactly one sentence is held. Synthesis runs ten times faster than real
time, so one is enough, and going deeper only multiplies what a seek throws
away.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: Nối vào content script

**Files:**
- Modify: `extension/src/entrypoints/content.ts`

**Interfaces:**
- Consumes: `VieNeuProvider` (Task 4), `FallbackProvider` (Task 5)
- Produces: bài giảng thật phát ra giọng VieNeu. Task 10 kiểm chứng.

**Không chạy `npm run test:e2e` ở task này.** Sau khi đổi provider, bài test e2e hiện có sẽ gặp một provider cố gọi `http://127.0.0.1:5599/health` — chưa có ai trả lời cho tới Task 9. Chạy nó ở đây chỉ tạo ra một lần đỏ đã biết trước.

- [ ] **Step 1: Sửa import ở đầu `extension/src/entrypoints/content.ts`**

Thêm hai dòng vào khối import sẵn có, giữ thứ tự alphabet như file đang dùng:

```ts
import { FallbackProvider } from '../core/fallback'
import { VieNeuProvider } from '../providers/vieneu'
```

- [ ] **Step 2: Bỏ dòng khởi tạo provider cũ**

Trong `main()`, xóa dòng đầu tiên:

```ts
    const provider = new WebSpeechProvider()
```

Giữ nguyên `const bridge = createPlayerBridge(document)` ngay dưới nó, và giữ nguyên import `WebSpeechProvider` — nó vẫn được dùng, chỉ đổi chỗ.

- [ ] **Step 3: Dựng provider sau khi `showNotice` đã tồn tại**

Ngay sau định nghĩa `const showNotice = (message: string): void => { ... }` và trước `window.addEventListener('message', ...)`, chèn:

```ts
    // Held separately from `provider` because warmUp() is VieNeu's own,
    // not part of the TTSProvider interface.
    const vieneu = new VieNeuProvider()

    const provider = new FallbackProvider(vieneu, new WebSpeechProvider(), {
      onStatusChange: (status) => {
        showNotice(
          status === 'fallback'
            ? 'Server TTS ngừng trả lời. Giọng dự phòng của trình duyệt thường im lặng trên máy này — chạy lại server rồi tải lại trang.'
            : 'Server TTS đã trở lại.',
        )
      },
    })
```

`showNotice` được khai báo bằng `const` ở trên, nhưng callback này chỉ **chạy** về sau nên không chạm vùng chết của khai báo.

- [ ] **Step 4: Sửa khối kiểm tra giọng trong `attach()`**

Khối hiện tại:

```ts
        const voiceAvailable = await provider.isAvailable()
        if (gen !== generation) return // don't toast lecture A's voice check over lecture B
        if (!voiceAvailable) {
          showNotice('Không có giọng đọc tiếng Việt trên trình duyệt này, lồng tiếng có thể không đúng.')
        }
```

Thay bằng:

```ts
        const voiceAvailable = await provider.isAvailable()
        if (gen !== generation) return // don't toast lecture A's voice check over lecture B
        if (!voiceAvailable) {
          // Both engines are out. Saying "the browser fallback will be used"
          // here would be a lie by omission: on this machine
          // speechSynthesis.speak() produces nothing at all, so the honest
          // message names the thing that can actually be fixed.
          showNotice('Chưa có giọng đọc: server TTS không chạy. Chạy server/install-agent.sh rồi tải lại trang.')
        } else if (provider.status === 'primary') {
          // Not awaited. The server needs about 4.3s to load the model and
          // another ~1.8s for its first inference; the point is to spend
          // that now, while the first translation batch is in flight,
          // instead of on the lecture's first sentence.
          void vieneu.warmUp()
        }
```

- [ ] **Step 5: Chạy đủ bộ test và typecheck**

```bash
cd /Users/anhdh/dubbing/extension && npm test && npm run typecheck
```

Expected: 206 test xanh (không test nào phủ `content.ts` trực tiếp — nó được phủ bởi e2e ở Task 9), typecheck sạch.

- [ ] **Step 6: Kiểm chứng bằng mắt rằng build ra được**

```bash
cd /Users/anhdh/dubbing/extension && npx wxt build 2>&1 | tail -8
grep -o '"http://127.0.0.1/\*"' .output/chrome-mv3/manifest.json
```

Expected: build xong không lỗi, và `grep` in ra `"http://127.0.0.1/*"` — nếu không có thì Task 3 Step 5 chưa được làm và mọi request tới server sẽ bị chặn khi chạy thật.

- [ ] **Step 7: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/src/entrypoints/content.ts
git commit -m "$(cat <<'MSG'
feat: dub with the local VieNeu voice, falling back to the browser

The "no voice" notice names the server rather than the fallback. M1 proved
speechSynthesis.speak() does nothing at all on this machine, so telling the
viewer a browser voice will be used would be a lie by omission — the server
is the thing they can actually start.

Warm-up is fired and not awaited: the server's ~6s of model load plus first
inference belongs in the window where the first translation batch is already
in flight.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: E2E — cả đường audio, chạy được trong CI

**Files:**
- Modify: `extension/scripts/serve-fixtures.mjs`
- Modify: `extension/tests/e2e/dubbing.spec.ts`

**Interfaces:**
- Consumes: mọi thứ từ Task 3–8
- Produces: bằng chứng chạy máy rằng service worker gọi được server, base64 đi qua được ranh giới process, và `HTMLAudioElement` phát được thứ nhận về.

**Vì sao stub chứ không phải server thật:** server thật giữ cổng 8770 thường trực dưới launchd (Task 2), nên một lần chạy e2e không bind được cổng đó. `TTS_BASE_URL` ở build `--mode e2e` trỏ sang `http://127.0.0.1:5599` — chính server fixture đang phục vụ trang — nên stub chỉ cần mọc thêm hai route.

- [ ] **Step 1: Cho server fixture biết tổng hợp giọng giả**

Trong `extension/scripts/serve-fixtures.mjs`, thêm hàm này ngay sau hằng `LECTURE_ROUTE`:

```js
// The extension only needs bytes that decode as audio and a duration header
// it can trust — nothing here has to sound like speech. A quiet 220 Hz tone
// is used rather than silence so anyone who plays the file can tell it
// arrived intact.
function wav(seconds, sampleRate = 24000) {
  const samples = Math.round(seconds * sampleRate)
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 8000), 44 + i * 2)
  }
  return buf
}

// Mirrors server/app.py's CORS policy. Not strictly needed — a service
// worker fetch to a host in host_permissions is exempt from CORS — but
// keeping the shapes identical means the stub fails the same way the real
// server would if that ever stops being true.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Expose-Headers': 'X-Audio-Duration',
}
```

- [ ] **Step 2: Thêm ba route vào handler**

Ngay sau dòng `const url = new URL(req.url ?? '/', 'http://localhost')` trong `createServer`, chèn:

```js
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end()
    return
  }

  if (url.pathname === '/health') {
    res
      .writeHead(200, { 'Content-Type': 'application/json', ...CORS })
      .end(JSON.stringify({ status: 'ok', model_loaded: true, stub: true }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let input = ''
      try {
        input = JSON.parse(body).input ?? ''
      } catch {
        // A malformed body yields the shortest clip rather than a 500 —
        // this stub is not the thing under test.
      }
      // Proportional to the text so the scheduler's stretch maths has
      // something varied to work on, and clamped so the run stays quick.
      const seconds = Math.min(3, Math.max(0.2, input.length / 20))
      const data = wav(seconds)
      res
        .writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': data.length,
          'X-Audio-Duration': seconds.toFixed(3),
          ...CORS,
        })
        .end(data)
    })
    return
  }
```

- [ ] **Step 3: Kiểm tra stub bằng tay trước khi viết test dựa vào nó**

```bash
cd /Users/anhdh/dubbing/extension && node scripts/serve-fixtures.mjs &
sleep 1
curl -s http://127.0.0.1:5599/health; echo
curl -s -D - -o /tmp/m2-stub.wav -X POST http://127.0.0.1:5599/v1/audio/speech \
  -H 'Content-Type: application/json' -d '{"input":"Xin chào, đây là một component React."}' \
  | grep -i 'x-audio-duration'
file /tmp/m2-stub.wav
kill %1
```

Expected: `{"status":"ok","model_loaded":true,"stub":true}`, một header `x-audio-duration` khoảng 1.9, và `file` nhận ra đó là `RIFF (little-endian) data, WAVE audio`.

- [ ] **Step 4: Thêm hai bài test e2e vào `extension/tests/e2e/dubbing.spec.ts`**

Thêm vào cuối file:

```ts
/** Launch options shared by the TTS tests. The autoplay flag matters:
 *  `new Audio().play()` is a programmatic play with no user gesture behind
 *  it, which Chrome blocks by default. `--mute-audio` keeps a CI machine
 *  quiet without stopping the decode. */
const TTS_LAUNCH_ARGS = [
  `--disable-extensions-except=${EXT}`,
  `--load-extension=${EXT}`,
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
]

/** The extension's own options page. A content script's isolated world is
 *  not reachable from page.evaluate, but an extension page is, and it has
 *  the same chrome.runtime access the content script uses. */
async function openExtensionPage(context: import('@playwright/test').BrowserContext) {
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }))
  const extensionId = new URL(serviceWorker.url()).host
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  return page
}

test('the service worker reaches the TTS server and returns playable audio', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: HEADLESS,
    channel: CHANNEL,
    args: TTS_LAUNCH_ARGS,
  })

  try {
    const page = await openExtensionPage(context)

    const health = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts-health' }))
    expect(health).toEqual({ ok: true })

    const spoken = (await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'tts-speak',
        text: 'Xin chào, đây là một component React.',
      }),
    )) as { audio?: string; duration?: number; error?: string }

    expect(spoken.error).toBeUndefined()
    expect(spoken.duration).toBeGreaterThan(0)
    // The first six bytes of any WAV. Proves the base64 round trip through
    // sendMessage's JSON serialisation preserved the bytes — the one thing
    // spec 8.3 says cannot be taken for granted.
    expect(atob(spoken.audio!.slice(0, 8)).startsWith('RIFF')).toBe(true)
  } finally {
    await context.close()
  }
})

test('the page can play synthesised audio at the rate ceiling', async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: HEADLESS,
    channel: CHANNEL,
    args: TTS_LAUNCH_ARGS,
  })

  try {
    const page = await openExtensionPage(context)

    const outcome = await page.evaluate(async () => {
      const res = (await chrome.runtime.sendMessage({
        type: 'tts-speak',
        text: 'Xin chào.',
      })) as { audio: string }

      const binary = atob(res.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
      const audio = new Audio(url)
      audio.preservesPitch = true
      audio.playbackRate = 1.4 // spec 6.2's ceiling — the worst case

      return new Promise<string>((resolve) => {
        audio.onended = () => resolve('ended')
        audio.onerror = () => resolve('error')
        setTimeout(() => resolve('timeout'), 8_000)
        audio.play().catch((e: Error) => resolve(`blocked: ${e.name}`))
      })
    })

    // Neither jsdom nor Node can exercise a real HTMLMediaElement, so this
    // is the only place the actual playback path is proven.
    expect(outcome).toBe('ended')
  } finally {
    await context.close()
  }
})
```

**Nếu test thứ hai không trả về `'ended'`:** báo cáo đúng giá trị nó trả về (`blocked: NotAllowedError`, `error`, hay `timeout`) và dừng lại hỏi. **Không xóa test.** Giá trị đó là thông tin thật về việc headless Chrome có phát được audio hay không, và nó quyết định Task 10 phải kiểm tra bằng tai những gì.

- [ ] **Step 5: Chạy e2e**

```bash
cd /Users/anhdh/dubbing/extension && npm run test:e2e
```

Expected: 3 test xanh (1 cũ + 2 mới).

- [ ] **Step 6: Chạy lại đủ bộ unit test và typecheck**

```bash
cd /Users/anhdh/dubbing/extension && npm test && npm run typecheck
```

Expected: 206 test xanh, typecheck sạch.

- [ ] **Step 7: Commit**

```bash
cd /Users/anhdh/dubbing
git add extension/scripts/serve-fixtures.mjs extension/tests/e2e/dubbing.spec.ts
git commit -m "$(cat <<'MSG'
test: prove the audio path end to end against a stub TTS server

The real server holds port 8770 permanently under launchd, so an e2e run
cannot bind it; an --mode e2e build points at the fixture server instead,
which grows /health and /v1/audio/speech.

This is the only place the real HTMLAudioElement is exercised — neither
Node nor jsdom can play audio — so it is also the only proof that the
base64 round trip through sendMessage preserves the bytes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Kiểm chứng trên một bài giảng Udemy thật

**Files:**
- Create: `docs/superpowers/2026-09-20-m2-verification.md`

**Đây là task cần người dùng ngồi máy.** M1 kết thúc bằng đúng một lần chạy như thế này, và chính nó phát hiện sáu lỗi mà 148 unit test bỏ lọt — trong đó có một lỗi khiến extension chưa từng được tiêm lấy một lần. Đừng bỏ qua nó, và đừng thay nó bằng suy luận.

- [ ] **Step 1: Chuẩn bị, và nói rõ cho người dùng cần gì ở họ**

Kiểm tra trước khi gọi họ:

```bash
curl -s http://127.0.0.1:8770/health; echo
cd /Users/anhdh/dubbing/extension && npx wxt build 2>&1 | tail -3
```

Rồi hướng dẫn họ: mở `chrome://extensions`, bật Developer mode, "Load unpacked", chọn `/Users/anhdh/dubbing/extension/.output/chrome-mv3`. Nếu extension đã nạp từ M1 thì bấm nút reload. Mở trang options của extension và kiểm tra API key Gemini còn đó.

- [ ] **Step 2: Chạy và quan sát bảy điều**

Người dùng mở một bài giảng Udemy tiếng Anh có phụ đề. Ghi lại từng mục — cả cái chạy được lẫn cái không:

1. **Có tiếng Việt phát ra không**, và nó là giọng VieNeu (giọng nam `Minh Quân`) hay giọng Apple.
2. **Câu đầu tiên vào lúc nào** so với câu tiếng Anh tương ứng — đúng lúc, hay trễ vài giây.
3. **Các câu sau có vào đúng lúc không.** Đây là thứ phần chuẩn bị trước mua về; nếu mọi câu vẫn trễ đều thì nó không hoạt động.
4. **Âm gốc có nhỏ lại khi đang đọc và to lại khi đọc xong không** (ducking, spec 6.3).
5. **Video có bị làm chậm không**, và nếu có thì nó có nghe ra được không.
6. **Tua giữa câu** — tiếng phải tắt ngay, không đọc nốt câu cũ, và không đọc chồng.
7. **Đổi sang bài giảng khác mà không tải lại trang** — cơ chế `lectureChanged` chưa từng được xác nhận trên dữ liệu thật ở M1.

Mở DevTools Console trên trang và tab service worker; chép lại mọi cảnh báo `[udemy-dubbing]`.

- [ ] **Step 3: Kiểm tra cơ chế dự phòng bằng cách tắt server thật**

```bash
launchctl bootout "gui/$UID/com.udemy-dubbing.tts"
```

Tải lại trang bài giảng. Expected: **không phải** thông báo `Chưa có giọng đọc: server TTS không chạy...`. Chuỗi đó chỉ xuất hiện khi *cả hai* engine đều không dùng được, còn `launchctl bootout` chỉ hạ server — `WebSpeechProvider.isAvailable()` vẫn trả về `true` trên máy này kể cả khi đó (M1 xác nhận `getVoices()` liệt kê cả `Linh` lẫn `Linh (Nâng cao)`, xem `docs/superpowers/2026-09-20-m1-verification.md`), nên `provider.isAvailable()` của `FallbackProvider` vẫn trả `true` qua nhánh dự phòng. Thông báo thực sự sẽ tới từ `onStatusChange('fallback', ...)`, sẵn ở `content.ts`: "Server TTS ngừng trả lời. Giọng dự phòng của trình duyệt thường im lặng trên máy này — chạy lại server rồi tải lại trang." Hai thông điệp đều đúng, chỉ cho hai tình huống khác nhau: cái đầu cho khi không còn giọng nào cả, cái này cho khi Web Speech vẫn "có" nhưng trên máy này nó câm. Mục đích của bước vẫn không đổi — xác nhận extension nói ra điều có thật và có thể hành động được, chứ không im lặng và không bảo "giọng dự phòng sẽ được dùng" khi thực tế nó không phát ra tiếng gì.

Bật lại:

```bash
cd /Users/anhdh/dubbing/server && ./install-agent.sh
```

- [ ] **Step 4: Đo thật, đừng ước lượng**

Trong lúc bài giảng chạy, xem server tốn bao nhiêu:

```bash
ps -o rss=,%cpu=,command= -p "$(launchctl list | awk '/com.udemy-dubbing.tts/ {print $1}')"
tail -20 /Users/anhdh/dubbing/server/tts.log
```

Ghi lại RSS (dự kiến khoảng 478 MB sau câu đầu) và %CPU.

- [ ] **Step 5: Viết `docs/superpowers/2026-09-20-m2-verification.md`**

Theo đúng cấu trúc bản M1 (`docs/superpowers/2026-09-20-m1-verification.md`): kết luận trước, rồi bảng "đã xác nhận hoạt động" kèm bằng chứng, rồi "chưa xác nhận", rồi mỗi lỗi do dữ liệu thật phát hiện được một mục riêng kèm nguyên nhân, rồi "việc còn lại". Viết bằng tiếng Việt. Ghi cả những thứ hỏng — bản M1 có giá trị chính vì nó ghi lại thất bại của Web Speech thay vì giấu đi.

- [ ] **Step 6: Commit**

```bash
cd /Users/anhdh/dubbing
git add docs/superpowers/2026-09-20-m2-verification.md
git commit -m "$(cat <<'MSG'
docs: record the M2 verification run on a real Udemy lecture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Hoàn thành M2

M2 xong khi tất cả những điều sau đúng:

- [ ] Server VieNeu chạy native dưới `launchd`, tự khởi động lại sau khi bị giết, và chỉ với tới được qua `127.0.0.1`.
- [ ] Một bài giảng Udemy thật phát ra giọng VieNeu, đồng bộ với video, không dừng hình.
- [ ] Tắt server thì extension **nói ra** điều đó thay vì im lặng.
- [ ] `npm test` xanh (206 test) và `npm run typecheck` sạch.
- [ ] `npm run test:e2e` xanh (3 test).
- [ ] `docs/superpowers/2026-09-20-m2-verification.md` tồn tại và ghi cả phần hỏng.
- [ ] Mọi quyết định phải tự đưa ra khi plan im lặng hoặc sai đều được ghi vào `docs/superpowers/2026-09-20-m2-rulings.md`, theo đúng lối M1 đã làm.

**Nằm ngoài M2, đừng làm:** cache IndexedDB, bảng điều khiển, lớp phụ đề tiếng Việt, ô cài đặt server trong trang options. Tất cả thuộc M3 (spec mục 12).
