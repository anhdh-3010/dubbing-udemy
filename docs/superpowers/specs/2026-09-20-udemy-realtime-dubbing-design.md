# Thiết kế Extension Lồng tiếng Udemy Thời gian thực

**Ngày:** 2026-09-20
**Trạng thái:** Thiết kế đã duyệt; sẵn sàng lập implementation plan
**Phạm vi:** Extension Chrome (Manifest V3) dùng riêng, nạp bằng load unpacked. Không phát hành lên Chrome Web Store.

---

## 1. Vấn đề

Khóa học Udemy dạy bằng tiếng Anh. Đọc phụ đề thì tranh mất sự chú ý dành cho màn hình — mà màn hình mới là chỗ chứa đoạn code đang được giảng. Extension này đọc bài giảng bằng tiếng Việt trong lúc video gốc vẫn chạy, theo thời gian thực, không tốn chi phí định kỳ.

## 2. Hướng tiếp cận

Udemy có sẵn file phụ đề kèm timestamp cho hầu hết bài giảng, và toàn bộ file đã nằm sẵn trước khi video chạy tới bất kỳ câu nào. Đúng một sự thật đó định hình toàn bộ thiết kế: extension có thể dịch và tổng hợp giọng **trước con trỏ phát**, thay vì chạy theo âm thanh. Không cần nhận dạng giọng nói, không cần ASR streaming, không phải gồng với ngân sách độ trễ từng giây.

Khi mở bài giảng, extension đọc các cue phụ đề, gộp chúng thành câu hoàn chỉnh, dịch theo lô — ưu tiên lô chứa vị trí đang phát để tiếng nói bắt đầu trong vài giây — rồi tổng hợp giọng chạy trước con trỏ phát một quãng. Âm thanh gốc được hạ nhỏ chứ không tắt hẳn. Video không bao giờ bị dừng.

## 3. Các quyết định đã chốt

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Nguồn văn bản | Track phụ đề của chính Udemy (`video.textTracks`) | Timestamp chính xác, biết trước toàn bộ nội dung, không tốn chi phí và độ trễ của ASR |
| Dịch | LLM API, người dùng tự cấp key (Gemini free tier) | Ngữ cảnh toàn bài thắng hẳn dịch máy từng câu với nội dung kỹ thuật; hạn mức miễn phí đủ cho một người |
| Giọng đọc | VieNeu v3 Nano, giọng **Minh Quân**, qua server HTTP cục bộ | Chất lượng tiếng Việt cao nhất mà vẫn miễn phí và chạy offline trên máy này; 11 giọng dựng sẵn; API tương thích OpenAI |
| Giọng dự phòng | Web Speech API (`Linh`) | Giữ extension dùng được khi server cục bộ không chạy |
| Chiến lược đồng bộ | Co giãn thích ứng; không bao giờ dừng video | Dừng video làm bài giảng giật cục và kéo dài thời lượng |
| Chiến lược chia lô | Dịch cả bài ở nền, lô đang xem trước | Độ trễ của streaming nhưng vẫn giữ chất lượng và khả năng cache của dịch trọn file |
| Phụ đề | Hiển thị phụ đề tiếng Việt | Gần như miễn phí khi đã có bản dịch; giúp người xem đối chiếu khi giọng đọc khó nghe |
| Giao diện glossary | Hoãn sang v2 | Giữ thuật ngữ kỹ thuật bằng tiếng Anh chỉ là một dòng trong prompt, không cần giao diện |

### Nằm ngoài phạm vi v1

Đóng gói lên Chrome Web Store, luồng onboarding, privacy policy, hỗ trợ đa trình duyệt, các nhà cung cấp TTS đám mây, giao diện quản lý glossary, nhân bản giọng.

## 4. Kiến trúc

### 4.1 Ranh giới tiến trình

Ba tiến trình, chia theo việc mỗi bên được phép làm:

**Content script** (chạy trong trang Udemy) nắm mọi thứ nhạy cảm về thời gian: phần tử `<video>`, vòng lặp scheduler, việc phát âm thanh, lớp phụ đề và bảng điều khiển. Toàn bộ logic thời gian nằm ở đây, trong một chỗ duy nhất.

**Service worker** nắm truy cập mạng và bí mật: khóa LLM API, các lời gọi dịch, và request tới server TTS cục bộ. Nó cố tình không giữ trạng thái phát, vì MV3 có thể chấm dứt nó bất cứ lúc nào mà không báo trước.

**Server TTS cục bộ** (`vieneu`, chạy ngoài trình duyệt) nắm việc tổng hợp giọng. Extension nói chuyện với nó qua `http://127.0.0.1:<port>/v1/audio/speech`.

Dữ liệu audio chảy từ service worker sang content script để phát. Tổng hợp ở đâu cũng được; **phát tiếng thì phải nằm cạnh video**.

### 4.2 Vì sao server TTS được phép dùng HTTP trần

Udemy phục vụ qua HTTPS, nên một request HTTP trần lẽ ra bị chặn vì mixed content. Chrome miễn trừ `http://127.0.0.1` và `http://localhost` — chúng được xếp vào nhóm origin có thể tin cậy. Chính điều này khiến server cục bộ trở nên khả thi mà không cần chứng chỉ, tên miền hay xác thực. Đây cũng là lý do server phải nằm trên loopback: miễn trừ đó không áp dụng cho địa chỉ LAN hay địa chỉ công khai.

### 4.3 Các module

| Module | Nhiệm vụ | Phụ thuộc |
|---|---|---|
| `player-bridge` | Bám vào `<video>` của Udemy; phát sự kiện play/pause/seek/ratechange; phát hiện đổi bài (Udemy là SPA, không có page reload) | DOM |
| `caption-source` | Tạo ra `Cue[]`. Chính: đọc `video.textTracks` ở chế độ `hidden`. Dự phòng: lấy URL `.vtt` từ API lecture của Udemy | `player-bridge` |
| `segmenter` | Gộp các cue vụn (Udemy cắt ở mức 3–6 chữ) thành câu hoàn chỉnh, giới hạn bởi dấu câu, khoảng lặng, và trần 12 giây | thuần túy |
| `translator` | Chia lô ~40 segment mỗi lời gọi LLM; sinh đồng thời `displayText` và `speechText`; kiểm tra và khớp kết quả theo id | `cache` |
| `tts-provider` | Interface `TTSProvider`. `VieNeuProvider` (chính), `WebSpeechProvider` (dự phòng) | — |
| `scheduler` | Vòng lặp lõi: đọc `currentTime` mỗi frame, quyết định đọc câu nào, tính tốc độ, điều khiển ducking và `playbackRate` | tất cả phần trên |
| `cache` | IndexedDB: bản dịch theo bài học, audio đã tổng hợp, dọn theo LRU | — |
| `ui` | Bảng điều khiển và lớp phụ đề trong Shadow DOM; trang options | `scheduler` |

### 4.4 Luồng dữ liệu

```
đổi bài (SPA)
  → player-bridge phát { videoEl, lectureId }
  → caption-source trả về Cue[]
  → segmenter gộp thành Segment[]
  → service worker chia lô, ƯU TIÊN lô chứa currentTime
  → LLM dịch → content script nhận → cache ghi xuống
  → scheduler bắt đầu đọc; các lô còn lại về dần ở nền
```

## 5. Mô hình dữ liệu

```ts
interface Cue {
  start: number          // giây
  end: number
  text: string
}

interface Segment {
  id: number
  start: number          // giây, theo timeline của phụ đề gốc
  end: number
  srcText: string        // tiếng Anh gốc
  displayText?: string   // tiếng Việt, dùng cho lớp phụ đề
  speechText?: string    // tiếng Việt, thuật ngữ đã phiên âm, dùng cho TTS
  status: 'pending' | 'translating' | 'ready' | 'failed'
}

interface SynthesisResult {
  audio: ArrayBuffer     // WAV 24 kHz từ VieNeu
  duration: number       // chính xác, biết trước khi phát
}

interface TTSProvider {
  readonly knowsDurationAhead: boolean
  isAvailable(): Promise<boolean>
  synthesize(text: string, signal: AbortSignal): Promise<SynthesisResult>
}
```

`displayText` và `speechText` là hai cách thể hiện của cùng một câu, được sinh ra trong cùng một lời gọi LLM. Mục 7 giải thích vì sao chúng khác nhau.

## 6. Đồng bộ

### 6.1 Quy tắc neo

Mỗi segment được neo vào `start` của chính nó. Các segment không bao giờ nối đuôi nhau. Đây là thứ ngăn sai lệch tích lũy: lỗi của một câu chết tại câu đó.

### 6.2 Tính tốc độ

Bản dịch tiếng Việt thường dài hơn phần tiếng Anh sinh ra nó, nên phần lớn segment cần nén lại. Ba tầng, áp dụng theo thứ tự:

1. LLM được yêu cầu dịch gọn, nhắm trong khoảng ±15% thời lượng câu gốc.
2. Tốc độ đọc của TTS được nâng lên, kẹp trong `[1.0, 1.4]`. Vượt 1.4 là giọng bắt đầu khó nghe.
3. Chỉ khi vẫn chưa đủ thì mới làm chậm video — sàn là thấp hơn 15% so với tốc độ người dùng đang chọn.

```
W        = (segment.end - segment.start) + gapAfter   // giây theo thời gian video
                                                      // gapAfter = khoảng lặng trước segment kế tiếp
haveWall = W / baseline                               // số giây thực tế có được
r        = clamp(duration / haveWall, 1.0, 1.4)       // tốc độ đọc TTS
needWall = duration / r

if needWall > haveWall:
    videoRate = max(0.85 * baseline, W / needWall)
else:
    videoRate = baseline
```

`baseline` là tốc độ phát **mà người dùng đã chọn** — không phải 1.0. Người học Udemy thường xem ở 1.25× hoặc 1.5×, và điều đó co ngân sách thời gian thực lại đúng bằng ngần ấy lần. Mọi phép tính đều tương đối so với `baseline`, và sàn làm chậm cũng tương đối, nên người đang xem 1.5× không bao giờ bị tụt về 0.85× tuyệt đối.

VieNeu báo thời lượng chính xác trước khi phát, nên công thức này giải một lần là xong. Bộ ước lượng thích ứng (đo số ký tự trên giây, tinh chỉnh bằng trung bình trượt sau mỗi câu) chỉ tồn tại để phục vụ `WebSpeechProvider`, thứ không thể báo trước thời lượng.

### 6.3 Ducking

Khi bắt đầu đọc, `video.volume` giảm dần xuống mức cấu hình (mặc định 0.1) trong khoảng 120ms; nó tăng trở lại khi đọc xong. Việc giảm dần này tránh tiếng cụp ở mỗi ranh giới câu.

### 6.4 Xử lý sự kiện

| Sự kiện | Hành vi |
|---|---|
| Tua | Hủy ngay việc tổng hợp và phát, tìm lại index segment bằng tìm kiếm nhị phân, khôi phục volume và `playbackRate` |
| Tạm dừng | Dừng audio; phát tiếp tại chỗ |
| Người dùng đổi tốc độ | Ghi nhận làm `baseline` mới; tính lại từ đó |
| Đổi bài | Tháo dỡ hoàn toàn rồi dựng lại |

## 7. Phiên âm thuật ngữ

Một model TTS chỉ biết tiếng Việt thì chưa bao giờ thấy bộ âm tiếng Anh trong lúc huấn luyện. Đưa cho nó "React component" sẽ sinh ra tạp âm. Nhưng mục tiêu vốn đã sai ngay từ đầu: người Việt dạy lập trình không phát âm "component" bằng giọng Anh-Mỹ giữa câu — họ nói "com-pô-nen".

Vì vậy translator sinh ra hai cách thể hiện cho mỗi segment. `displayText` giữ nguyên "React component" vì đó là thứ người ta muốn *nhìn thấy*. `speechText` mang dạng đã phiên âm vì đó là thứ nghe đúng khi *đọc lên*. Một lời gọi LLM sinh ra cả hai, nên việc này không tốn thêm request nào.

**Ràng buộc:** bản phiên âm phải dùng chính tả hợp lệ của tiếng Việt. Đo được trong lúc thiết kế: "prốp" thất bại vì tiếng Việt không có cụm phụ âm `pr` — bộ phonemizer rơi về tiếng Anh, và có một lần đánh vần từng chữ cái. "pờ-rốp" thì sạch.

**Kiểm tra tự động:** chạy `speechText` qua `espeak-ng -v vi -q --ipa` rồi tìm dấu chuyển ngôn ngữ `(en)` sẽ phát hiện được bản phiên âm sai mà không cần ai nghe. Đây được dùng như một bộ linter độc lập — VieNeu dùng phonemizer `sea-g2p` riêng của nó, nên phép kiểm tra này xác nhận *văn bản*, không phải nội tình của VieNeu.

Tính năng này là một tùy chọn, mặc định bật. Xem câu hỏi còn treo số 1.

## 8. Server TTS cục bộ

**Runtime:** `vieneu` (đã xác nhận v3.8.1), đường ONNX, không cần PyTorch. Model `VieNeu-TTS-v3-Nano`, ~282MB, 24 kHz, giọng `Minh Quân`.

**Endpoint:** `POST http://127.0.0.1:<port>/v1/audio/speech`, tương thích OpenAI. Có một hệ quả đáng nói: **một implementation `TTSProvider` duy nhất** phục vụ được cả server này lẫn API của OpenAI, nếu sau này muốn dùng đám mây. Chỉ khác base URL.

**Yêu cầu:**
- Server đặt header `Access-Control-Allow-Origin: chrome-extension://<id của extension>`.
- Extension khai báo `host_permissions: ["http://127.0.0.1/*"]` (match pattern bỏ qua port, nên khai báo này phủ mọi port).
- Request được phát đi từ service worker chứ không phải content script, để chúng chạy trên origin của extension và không chịu ràng buộc CSP của trang.
- Một `launchd` user agent giữ cho server chạy qua mỗi lần khởi động máy.

**Khả dụng:** scheduler dò server khi bắt đầu bài giảng và mỗi khi có lỗi. Khi không liên lạc được, extension rơi về `WebSpeechProvider` và **báo rõ trong bảng điều khiển** thay vì im lặng.

**Ghi chú về lượng tử hóa:** bản int8 của VieNeu nhanh hơn ~1.6 lần nhưng đòi AVX-512 VNNI / AVX-VNNI — các tập lệnh x86 mà Apple Silicon không có, và tài liệu cảnh báo sẽ cho ra audio méo nếu thiếu. Trên máy này chỉ đường fp32 dùng được. Thay vào đó, tham số `steps` là núm điều chỉnh (xem câu hỏi còn treo số 2).

## 9. Cache

IndexedDB, do service worker sở hữu.

- **Bản dịch** khóa theo `lectureId + captionLang + targetLang + model`. Xem lại một bài giảng không tốn gì.
- **Audio** khóa theo `hash của segment + giọng + steps`, dọn theo LRU trong hạn mức cấu hình được.
- Khi hết hạn mức: dọn LRU, thử lại một lần, rồi chạy không cache thay vì báo lỗi.

## 10. Xử lý lỗi

Nguyên tắc chi phối: hỏng cái gì thì lùi về xem video như bình thường. Không bao giờ im lặng mà không nói vì sao.

| Sự cố | Hành vi |
|---|---|
| Bài giảng không có phụ đề | Báo trong bảng điều khiển, tắt lồng tiếng, để video yên |
| Key sai hoặc hết hạn mức | Thông báo rõ kèm lối tới trang options; **ngừng gọi API** thay vì thử lại vô hạn |
| Một lô dịch thất bại | Thử lại hai lần có backoff; sau đó các segment ấy **phát âm thanh gốc ở âm lượng đầy** |
| LLM trả về id sai hoặc thiếu | Chỉ nhận các id khớp; đưa phần còn lại vào hàng đợi lại. Chuyện này xảy ra thật khi dịch theo lô và bắt buộc phải kiểm tra |
| Không liên lạc được server TTS | Rơi về Web Speech, hiện trạng thái trong bảng điều khiển |
| Tổng hợp thất bại ở một segment | Bỏ qua; âm thanh gốc phát ở âm lượng đầy trong khoảng đó |
| IndexedDB đầy | Dọn LRU; vẫn lỗi thì chạy không cache |
| Service worker bị chấm dứt | Content script giữ trạng thái, phát hiện port đóng, kết nối lại và hỏi lại phần còn thiếu |

## 11. Kiểm thử

Bộ máy đồng bộ là nơi bug sẽ trú ngụ, và gần như toàn bộ nó kiểm thử được mà không cần trình duyệt.

**Unit (Vitest), các hàm thuần:** gộp cue, tính tốc độ, chia lô, tra cứu index segment, kiểm tra phản hồi LLM, linter phiên âm.

**Scheduler (Vitest + provider giả):** `FakeTranslator` trả về văn bản có độ dài điều khiển được; `FakeTTS` báo thời lượng tùy ý; một đồng hồ ảo điều khiển phần tử video giả. Cách này phủ được những ca khó — câu dịch dài gấp đôi khung thời gian, tua giữa câu, đổi tốc độ đang khi đọc — mà không cần Udemy và không cần phần cứng âm thanh.

**End-to-end (Playwright):** một trang fixture cục bộ có `<video>` và track VTT dựng giống Udemy, nạp extension thật. Chạy được trong CI, không cần tài khoản Udemy.

**Thủ công:** chỉ `player-bridge`. Đó là module duy nhất có môi trường không thể giả lập trung thực.

## 12. Các mốc

**M1 — pipeline chạy được.** `player-bridge`, `caption-source`, `segmenter`, translator, `WebSpeechProvider`, `scheduler`. Không cần cài đặt gì, nên bộ máy đồng bộ được kiểm chứng riêng trước khi đưa server vào. Hoàn thành khi một bài giảng Udemy thật phát ra tiếng Việt.

**M2 — giọng thật.** `VieNeuProvider`, server cục bộ, `launchd` agent, dò khả dụng và cơ chế dự phòng.

**M3 — dùng được hằng ngày.** Cache IndexedDB, bảng điều khiển, lớp phụ đề tiếng Việt, trang options.

**M4 — mài các cạnh sắc.** Linter phiên âm, toàn bộ bảng xử lý lỗi, tinh chỉnh việc dọn cache.

## 13. Câu hỏi còn treo

1. **Phiên âm giúp hay hại với VieNeu Nano?** Tài liệu ghi Nano yếu ở văn bản chuyển ngữ En-Vi, và đó chính là thứ phiên âm muốn né — nhưng Nano có thể vốn đã đọc tiếng Anh với chất giọng Việt nghe tự nhiên. Cứ làm tùy chọn, quyết định dựa trên bài giảng thật.
2. **Tổng hợp 8 bước có nghe tệ hơn 16 bước không?** Nếu không thì dùng 8: RTF đo được giảm từ 0.18 xuống 0.094, tức CPU giảm một nửa — điều đáng kể khi máy chạy pin.
3. **`textTracks` của Udemy có luôn lộ đủ danh sách cue không?** Phụ đề VTT nạp rời thì có; phụ đề nhúng theo phân đoạn trong HLS thì có thể không. Đường dự phòng qua API lecture tồn tại vì lý do này, nhưng điều kiện kích hoạt cần xác nhận trên khóa học thật.
4. **Server nên chạy thường trực hay bật theo nhu cầu?** Thường trực thì đơn giản hơn và tốn RAM nhàn rỗi; bật theo nhu cầu thì tiết kiệm tài nguyên nhưng thêm độ trễ khởi động vào câu đầu tiên.

---

## Phụ lục A — Số đo

Đo trong lúc thiết kế, trên chính máy đích: **Apple M2 Pro, 10 nhân (6P/4E), 16GB RAM, arm64**.

| Engine | Cùng một đoạn | RTF | Ghi chú |
|---|---|---|---|
| Apple `Linh (Enhanced)` | 13.33s | 0.12 | Không với tới được qua Web Speech; cần native messaging |
| Apple `Linh` (compact) | không đo | — | Giọng tiếng Việt duy nhất mà Web Speech của Chrome lộ ra; đo được 5.56s so với 5.17s của bản Enhanced trên một câu ngắn hơn |
| Piper `vais1000-medium` | 9.85s | 0.045 | Giọng tiếng Việt chính thức tốt nhất của Piper; khoảng 1.000 câu huấn luyện |
| `CSA v3` định dạng Piper | 9.53s | 0.061 | 257 giờ dữ liệu tổng hợp, 5 giọng |
| **VieNeu v3 Nano, 16 bước** | **10.67s** | **0.18** | 24 kHz, 11 giọng dựng sẵn — **đã chọn** |
| VieNeu v3 Nano, 8 bước | 10.69s | 0.094 | Chênh lệch chất lượng chưa đánh giá |

Nạp model lần đầu kèm tải về: 56.7s. Nạp khi đã có sẵn: khoảng 3s theo tài liệu gốc.

Để tham chiếu, giọng Apple đọc cùng đoạn đó **chậm hơn VieNeu 25%**, và điều này trực tiếp làm tăng tần suất các tầng nén ở mục 6.2 phải can thiệp.
