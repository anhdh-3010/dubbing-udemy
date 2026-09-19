# Thiết kế Extension Lồng tiếng Udemy Thời gian thực

**Ngày:** 2026-09-20
**Trạng thái:** Thiết kế đã duyệt; sẵn sàng lập implementation plan
**Phạm vi:** Extension Chrome (Manifest V3) dùng riêng, nạp bằng load unpacked. Không phát hành lên Chrome Web Store.

---

## 1. Vấn đề

Khóa học Udemy dạy bằng tiếng Anh. Đọc phụ đề thì tranh mất sự chú ý dành cho màn hình — mà màn hình mới là chỗ chứa đoạn code đang được giảng. Extension này đọc bài giảng bằng tiếng Việt trong lúc video gốc vẫn chạy, theo thời gian thực, không tốn chi phí định kỳ.

## 2. Hướng tiếp cận

Udemy có sẵn file phụ đề kèm timestamp cho hầu hết bài giảng, và toàn bộ file đã nằm sẵn trước khi video chạy tới bất kỳ câu nào. Đúng một sự thật đó định hình toàn bộ thiết kế: extension có thể dịch và tổng hợp giọng **trước con trỏ phát**, thay vì chạy theo âm thanh. Không cần nhận dạng giọng nói, không cần ASR streaming, không phải gồng với ngân sách độ trễ từng giây.

Khi mở bài giảng, extension lấy file phụ đề, gộp các cue thành câu hoàn chỉnh, dịch theo lô — ưu tiên lô chứa vị trí đang phát để tiếng nói bắt đầu trong vài giây — rồi tổng hợp giọng chạy trước con trỏ phát một quãng. Âm thanh gốc được hạ nhỏ chứ không tắt hẳn. Video không bao giờ bị dừng.

## 3. Các quyết định đã chốt

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Nguồn văn bản | Bắt request `.vtt` mà Udemy gọi; `video.textTracks` làm dự phòng | Cho trọn vẹn transcript ngay lập tức, không phụ thuộc người dùng có bật phụ đề hay không |
| Dịch | LLM API, người dùng tự cấp key (Gemini free tier) | Ngữ cảnh toàn bài thắng hẳn dịch máy từng câu với nội dung kỹ thuật; hạn mức miễn phí đủ cho một người |
| Thuật ngữ IT | **Giữ nguyên tiếng Anh** trong bản dịch | Người học vốn đọc tài liệu bằng tiếng Anh; dịch thuật ngữ sang tiếng Việt làm câu khó hiểu hơn chứ không dễ hơn |
| Giọng đọc | VieNeu v3 Nano, giọng **Minh Quân**, qua server HTTP cục bộ | Chất lượng tiếng Việt cao nhất mà vẫn miễn phí và chạy offline trên máy này; 11 giọng dựng sẵn; API tương thích OpenAI |
| Số bước tổng hợp | **8 bước** | Nghe hay hơn 16 bước khi đánh giá bằng tai, và tốn đúng một nửa CPU |
| Giọng dự phòng | Web Speech API (`Linh`) | Giữ extension dùng được khi server cục bộ không chạy |
| Đóng gói server | Native + `launchd` mặc định; kèm `Dockerfile` để tái lập | Xem mục 8.1 |
| Chiến lược đồng bộ | Co giãn thích ứng; không bao giờ dừng video | Dừng video làm bài giảng giật cục và kéo dài thời lượng |
| Chiến lược chia lô | Dịch cả bài ở nền, lô đang xem trước | Độ trễ của streaming nhưng vẫn giữ chất lượng và khả năng cache của dịch trọn file |
| Phụ đề | Hiển thị phụ đề tiếng Việt | Gần như miễn phí khi đã có bản dịch; giúp người xem đối chiếu khi giọng đọc khó nghe |

### Nằm ngoài phạm vi v1

Đóng gói lên Chrome Web Store, luồng onboarding, privacy policy, hỗ trợ đa trình duyệt, các nhà cung cấp TTS đám mây, giao diện quản lý glossary, nhân bản giọng, provider chạy WASM (xem mục 8.2).

## 4. Kiến trúc

### 4.1 Ranh giới tiến trình

Ba tiến trình, chia theo việc mỗi bên được phép làm:

**Content script** (chạy trong trang Udemy) nắm mọi thứ nhạy cảm về thời gian: phần tử `<video>`, vòng lặp scheduler, việc phát âm thanh, lớp phụ đề và bảng điều khiển. Toàn bộ logic thời gian nằm ở đây, trong một chỗ duy nhất.

**Service worker** nắm truy cập mạng và bí mật: khóa LLM API, các lời gọi dịch, tải file phụ đề, và request tới server TTS cục bộ. Nó cố tình không giữ trạng thái phát, vì MV3 có thể chấm dứt nó bất cứ lúc nào mà không báo trước.

**Server TTS cục bộ** (`vieneu`, chạy ngoài trình duyệt) nắm việc tổng hợp giọng. Extension nói chuyện với nó qua `http://127.0.0.1:<port>/v1/audio/speech`.

Dữ liệu audio chảy từ service worker sang content script để phát. Tổng hợp ở đâu cũng được; **phát tiếng thì phải nằm cạnh video**.

### 4.2 Vì sao server TTS được phép dùng HTTP trần

Udemy phục vụ qua HTTPS, nên một request HTTP trần lẽ ra bị chặn vì mixed content. Chrome miễn trừ `http://127.0.0.1` và `http://localhost` — chúng được xếp vào nhóm origin có thể tin cậy. Chính điều này khiến server cục bộ trở nên khả thi mà không cần chứng chỉ, tên miền hay xác thực. Đây cũng là lý do server phải nằm trên loopback: miễn trừ đó không áp dụng cho địa chỉ LAN hay địa chỉ công khai.

### 4.3 Các module

| Module | Nhiệm vụ | Phụ thuộc |
|---|---|---|
| `player-bridge` | Bám vào `<video>` của Udemy; phát sự kiện play/pause/seek/ratechange; phát hiện đổi bài (Udemy là SPA, không có page reload) | DOM |
| `caption-source` | Tạo ra `Cue[]` từ file `.vtt` của Udemy. Chi tiết ở mục 4.5 | `player-bridge` |
| `segmenter` | Gộp các cue vụn (Udemy cắt ở mức 3–6 chữ) thành câu hoàn chỉnh, giới hạn bởi dấu câu, khoảng lặng, và trần 12 giây | thuần túy |
| `translator` | Chia lô ~40 segment mỗi lời gọi LLM; giữ nguyên thuật ngữ IT; kiểm tra và khớp kết quả theo id | `cache` |
| `tts-provider` | Interface `TTSProvider`. `VieNeuProvider` (chính), `WebSpeechProvider` (dự phòng) | — |
| `scheduler` | Vòng lặp lõi: đọc `currentTime` mỗi frame, quyết định đọc câu nào, tính tốc độ, điều khiển ducking và `playbackRate` | tất cả phần trên |
| `cache` | IndexedDB: bản dịch theo bài học, audio đã tổng hợp, dọn theo LRU | — |
| `ui` | Bảng điều khiển và lớp phụ đề trong Shadow DOM; trang options | `scheduler` |

### 4.4 Luồng dữ liệu

```
đổi bài (SPA)
  → player-bridge phát { videoEl, lectureId }
  → caption-source bắt được URL .vtt → service worker tải → parse thành Cue[]
  → segmenter gộp thành Segment[]
  → service worker chia lô, ƯU TIÊN lô chứa currentTime
  → LLM dịch → content script nhận → cache ghi xuống
  → scheduler bắt đầu đọc; các lô còn lại về dần ở nền
```

### 4.5 Lấy phụ đề

Udemy luôn gọi một API trả về file `.vtt` khi nạp bài giảng. Bắt request đó là cách lấy transcript đáng tin cậy nhất: nó cho trọn vẹn nội dung ngay lập tức và không phụ thuộc vào việc người dùng có bật phụ đề trên player hay không.

Ràng buộc của MV3 phải tính tới: `chrome.webRequest` **không đọc được response body**, và bản blocking đã bị gỡ khỏi MV3. Nên cơ chế gồm hai bước:

1. Một script chạy ở **MAIN world** vá `fetch` và `XMLHttpRequest` để ghi lại URL của file `.vtt` — cùng với JSON liệt kê các track phụ đề — khi trang gọi tới.
2. Service worker tự `fetch` URL đó kèm credentials rồi parse nội dung VTT.

**Đường dự phòng:** đọc `video.textTracks` ở chế độ `hidden`. Dùng khi việc bắt request không thành — ví dụ phụ đề đã nằm trong cache của trang nên không có request nào phát ra để mà bắt.

Cần xác nhận ở M1: dạng chính xác của endpoint và tên trường chứa URL caption.

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
  viText?: string        // bản dịch, dùng cho cả phụ đề lẫn giọng đọc
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

Mỗi segment chỉ có **một** bản dịch duy nhất, dùng chung cho phụ đề và giọng đọc. Mục 7 giải thích vì sao không cần tách làm hai.

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

## 7. Xử lý thuật ngữ IT

Bản dịch **giữ nguyên thuật ngữ IT bằng tiếng Anh**. Prompt yêu cầu dịch phần văn xuôi sang tiếng Việt tự nhiên, nhưng không đụng vào tên công nghệ, tên thư viện, từ khóa ngôn ngữ, và những thuật ngữ mà lập trình viên Việt vốn dùng nguyên gốc.

Chuẩn mực để đối chiếu:

| | |
|---|---|
| Gốc | "today we implement a project react with backend fastapi" |
| **Đúng** | "hôm nay chúng ta sẽ triển khai một project React với backend là FastAPI" |
| Sai | "hôm nay chúng ta sẽ hiện thực một dự án phản ứng với hậu trường nhanh api" |

Quy tắc này áp dụng cho cả phụ đề lẫn giọng đọc, nên mỗi segment chỉ cần **một** bản dịch — không tách `displayText` và `speechText`, và không có bước phiên âm nào.

Hệ quả kỹ thuật: VieNeu Nano sẽ đọc các từ tiếng Anh với chất giọng Việt. Tài liệu của VieNeu gọi đó là điểm yếu của bản Nano, nhưng nó lại trùng khớp với cách người Việt dạy lập trình thực sự phát âm — không ai nói "component" bằng giọng Anh-Mỹ giữa câu tiếng Việt. Ở đây điểm yếu công bố và nhu cầu thực tế đi cùng một hướng.

Danh sách từ cần giữ nguyên nằm trong prompt chứ không phải một file cấu hình riêng. Chỉ khi nào phát hiện LLM dịch nhầm một nhóm từ cụ thể và lặp lại thì mới cân nhắc làm glossary (v2).

## 8. Server TTS cục bộ

**Runtime:** `vieneu` (đã xác nhận v3.8.1), đường ONNX, không cần PyTorch. Model `VieNeu-TTS-v3-Nano`, 269MB trọng số, 24 kHz, giọng `Minh Quân`.

**Endpoint:** `POST http://127.0.0.1:<port>/v1/audio/speech`, tương thích OpenAI. Có một hệ quả đáng nói: **một implementation `TTSProvider` duy nhất** phục vụ được cả server này lẫn API của OpenAI, nếu sau này muốn dùng đám mây. Chỉ khác base URL.

**Yêu cầu:**
- Server đặt header `Access-Control-Allow-Origin: chrome-extension://<id của extension>`.
- Extension khai báo `host_permissions: ["http://127.0.0.1/*"]` (match pattern bỏ qua port, nên khai báo này phủ mọi port).
- Request được phát đi từ service worker chứ không phải content script, để chúng chạy trên origin của extension và không chịu ràng buộc CSP của trang.

**Khả dụng:** scheduler dò server khi bắt đầu bài giảng và mỗi khi có lỗi. Khi không liên lạc được, extension rơi về `WebSpeechProvider` và **báo rõ trong bảng điều khiển** thay vì im lặng.

**Ghi chú về lượng tử hóa:** bản int8 của VieNeu nhanh hơn ~1.6 lần nhưng đòi AVX-512 VNNI / AVX-VNNI — các tập lệnh x86 mà Apple Silicon không có, và tài liệu cảnh báo sẽ cho ra audio méo nếu thiếu. Trên máy này chỉ đường fp32 dùng được. Núm điều chỉnh thay thế là tham số `steps`, đã chốt ở **8**.

### 8.1 Đóng gói

Hai cách, cùng một interface HTTP nên đổi qua lại không ảnh hưởng gì tới extension.

**Native + `launchd` — mặc định.** Một venv Python và một file plist trong `~/Library/LaunchAgents`. Chạy thẳng trên CPU, không có tầng ảo hóa nào ở giữa, khởi động cùng máy.

**Docker — tùy chọn, dành cho tái lập.** Máy này đã có Docker CLI 28.5.2 và Colima 0.9.1, nhưng daemon chưa chạy. Colima dựng một VM Linux arm64 nên không có giả lập kiến trúc và phần tính toán không bị phạt nặng, nhưng vẫn mất một phần hiệu năng cho tầng ảo hóa và tốn RAM cố định cấp cho VM. Đổi lại được môi trường tái lập, gỡ sạch dễ, và chuyển sang máy khác không phải dựng lại từ đầu.

**Vòng đời:** server chạy thường trực dưới `launchd`, nhưng **nạp model lười** — tiến trình lên ngay khi máy khởi động, còn trọng số chỉ được nạp ở request đầu tiên. Cách này cho RAM nhàn rỗi thấp mà vẫn không phải trả giá khởi động thật: lần nạp nguội đo được 5.0 giây, và nó trùng lặp với khoảng thời gian lô dịch đầu tiên đang chạy, nên người dùng không cảm thấy.

Quyết định: **M2 làm native**, kèm `Dockerfile` và `docker-compose.yml` trong repo cho ai cần. Với một server chạy loopback phục vụ đúng một người trên đúng máy này, tính tái lập của Docker chưa đổi được cho cái giá của nó. Mức phạt hiệu năng cụ thể của Colima đo được nếu cần — xem câu hỏi còn treo số 3.

### 8.2 WASM — vì sao không dùng cho VieNeu

VieNeu Nano gồm ba đồ thị ONNX tổng cộng 269MB (`vector_estimator` 148MB, `codec_decoder` 95MB, `text_encoder` 25MB), cộng phonemizer `sea-g2p` hiện chưa có bản chạy trong trình duyệt. Quan trọng hơn, kiến trúc flow-matching chạy 8–16 lượt suy luận cho mỗi câu, nên mức phạt hiệu năng của WASM bị nhân lên đúng ngần ấy lần. Không khả thi.

Con đường WASM thực tế là quay về model định dạng Piper — cụ thể `CSA v3` (74MB, RTF 0.061 đo trong lúc thiết kế). Nó thấp hơn VieNeu một bậc về chất lượng nhưng nằm gọn trong extension và không cần server nào cả.

Vì `TTSProvider` vốn đã là một interface, thêm `WasmProvider` sau này không phải đụng vào phần lõi. Đề xuất: **để dành cho v2**, và khi làm thì cho nó thay chỗ `WebSpeechProvider` trong chuỗi dự phòng — thành VieNeu → CSA v3 (WASM) → Web Speech. Không đưa vào v1 vì nó thêm 74MB cùng một đường mã nữa phải bảo trì, trong khi dự phòng chỉ dùng tới lúc server chết.

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
| Không bắt được request `.vtt` | Lùi sang đọc `video.textTracks`; vẫn không có thì coi như không có phụ đề |
| Key sai hoặc hết hạn mức | Thông báo rõ kèm lối tới trang options; **ngừng gọi API** thay vì thử lại vô hạn |
| Một lô dịch thất bại | Thử lại hai lần có backoff; sau đó các segment ấy **phát âm thanh gốc ở âm lượng đầy** |
| LLM trả về id sai hoặc thiếu | Chỉ nhận các id khớp; đưa phần còn lại vào hàng đợi lại. Chuyện này xảy ra thật khi dịch theo lô và bắt buộc phải kiểm tra |
| Không liên lạc được server TTS | Rơi về Web Speech, hiện trạng thái trong bảng điều khiển |
| Tổng hợp thất bại ở một segment | Bỏ qua; âm thanh gốc phát ở âm lượng đầy trong khoảng đó |
| IndexedDB đầy | Dọn LRU; vẫn lỗi thì chạy không cache |
| Service worker bị chấm dứt | Content script giữ trạng thái, phát hiện port đóng, kết nối lại và hỏi lại phần còn thiếu |

## 11. Kiểm thử

Bộ máy đồng bộ là nơi bug sẽ trú ngụ, và gần như toàn bộ nó kiểm thử được mà không cần trình duyệt.

**Unit (Vitest), các hàm thuần:** gộp cue, parse VTT, tính tốc độ, chia lô, tra cứu index segment, kiểm tra phản hồi LLM.

**Scheduler (Vitest + provider giả):** `FakeTranslator` trả về văn bản có độ dài điều khiển được; `FakeTTS` báo thời lượng tùy ý; một đồng hồ ảo điều khiển phần tử video giả. Cách này phủ được những ca khó — câu dịch dài gấp đôi khung thời gian, tua giữa câu, đổi tốc độ đang khi đọc — mà không cần Udemy và không cần phần cứng âm thanh.

**End-to-end (Playwright):** một trang fixture cục bộ có `<video>` và track VTT dựng giống Udemy, nạp extension thật. Runs được trong CI, không cần tài khoản Udemy.

**Thủ công:** chỉ `player-bridge` và việc bắt request phụ đề. Đó là hai phần có môi trường không thể giả lập trung thực.

## 12. Các mốc

**M1 — pipeline chạy được.** `player-bridge`, `caption-source` (kèm xác nhận endpoint thật của Udemy), `segmenter`, translator, `WebSpeechProvider`, `scheduler`. Không cần cài đặt gì, nên bộ máy đồng bộ được kiểm chứng riêng trước khi đưa server vào. Hoàn thành khi một bài giảng Udemy thật phát ra tiếng Việt.

**M2 — giọng thật.** `VieNeuProvider`, server cục bộ chạy native, `launchd` agent, `Dockerfile` kèm theo, dò khả dụng và cơ chế dự phòng.

**M3 — dùng được hằng ngày.** Cache IndexedDB, bảng điều khiển, lớp phụ đề tiếng Việt, trang options.

**M4 — mài các cạnh sắc.** Toàn bộ bảng xử lý lỗi, tinh chỉnh việc dọn cache, tinh chỉnh prompt giữ thuật ngữ.

## 13. Câu hỏi còn treo

1. **Endpoint phụ đề của Udemy có dạng chính xác ra sao?** Cơ chế bắt request đã chốt; còn phải xác nhận URL, tên trường chứa caption, và liệu có khóa học nào chỉ dùng phụ đề nhúng trong HLS hay không. Đây là việc xác minh ở M1, không phải câu hỏi thiết kế.
2. **Có cần đo mức phạt hiệu năng của Colima không?** Chỉ đáng làm nếu sau này thực sự muốn chạy server trong Docker thay vì native.

---

## Phụ lục A — Số đo

Đo trong lúc thiết kế, trên chính máy đích: **Apple M2 Pro, 10 nhân (6P/4E), 16GB RAM, arm64**.

| Engine | Cùng một đoạn | RTF | Ghi chú |
|---|---|---|---|
| Apple `Linh (Enhanced)` | 13.33s | 0.12 | Không với tới được qua Web Speech; cần native messaging |
| Apple `Linh` (compact) | không đo | — | Giọng tiếng Việt duy nhất mà Web Speech của Chrome lộ ra; đo được 5.56s so với 5.17s của bản Enhanced trên một câu ngắn hơn |
| Piper `vais1000-medium` | 9.85s | 0.045 | Giọng tiếng Việt chính thức tốt nhất của Piper; khoảng 1.000 câu huấn luyện |
| `CSA v3` định dạng Piper | 9.53s | 0.061 | 257 giờ dữ liệu tổng hợp, 5 giọng — ứng viên cho `WasmProvider` ở v2 |
| VieNeu v3 Nano, 16 bước | 10.67s | 0.188 | 24 kHz, 11 giọng dựng sẵn |
| **VieNeu v3 Nano, 8 bước** | **10.69s** | **0.094** | **Đã chọn** — nghe hay hơn 16 bước, CPU bằng một nửa |

Nạp model lần đầu kèm tải về: 56.7s. Nạp nguội khi model đã có sẵn trên đĩa: **5.0s** đo được.

Trên một đoạn dài hơn (17.2 giây audio), 16 bước tốn 3.23s suy luận còn 8 bước tốn 1.61s. Quy ra một giờ bài giảng: CPU làm việc khoảng 11 phút so với 5,6 phút.

Để tham chiếu, giọng Apple đọc cùng đoạn đó **chậm hơn VieNeu 25%**, và điều này trực tiếp làm tăng tần suất các tầng nén ở mục 6.2 phải can thiệp.
