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
| Đóng gói server | **Native + `launchd`** | Docker đã dựng và đo được, nhưng chậm hơn 2.7 lần trong khi lợi ích tái lập của nó không được dùng tới trên một máy một người. `Dockerfile` vẫn giữ trong repo. Xem mục 8.1 |
| Chiến lược đồng bộ | Co giãn thích ứng; không bao giờ dừng video | Dừng video làm bài giảng giật cục và kéo dài thời lượng |
| Chiến lược chia lô | Dịch cả bài ở nền, lô đang xem trước | Độ trễ của streaming nhưng vẫn giữ chất lượng và khả năng cache của dịch trọn file |
| Phụ đề | Hiển thị phụ đề tiếng Việt | Gần như miễn phí khi đã có bản dịch; giúp người xem đối chiếu khi giọng đọc khó nghe |

### Nằm ngoài phạm vi v1

Đóng gói lên Chrome Web Store, luồng onboarding, privacy policy, hỗ trợ đa trình duyệt, các nhà cung cấp TTS đám mây, giao diện quản lý glossary, nhân bản giọng, provider chạy WASM — xem mục 8.2, đây là spike của v2 chứ không phải bị loại.

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
| `server/app.py` | Wrapper FastAPI bọc VieNeu Nano; chạy ngoài trình duyệt trong Docker | — |

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

### 4.4b Trang bài giảng chạy ở đâu

**Đã quan sát (2026-09-20).** Trang học bài không nằm ở `www.udemy.com` mà ở **`lg.udemy.com`**, và nó là document cấp cao nhất chứ không phải iframe. Đường dẫn vẫn giữ dạng `/course/{slug}/learn/lecture/{lectureId}`.

Điều này quyết định `matches` của content script. Match pattern của Chrome đòi host trùng khít khi không có wildcard, nên `https://www.udemy.com/*` **không** khớp `lg.udemy.com` — extension sẽ không được tiêm và nằm im hoàn toàn, không có dấu hiệu lỗi nào. Manifest phải liệt kê cả hai host.

### 4.5 Lấy phụ đề

Udemy luôn gọi một API trả về file `.vtt` khi nạp bài giảng. Bắt request đó là cách lấy transcript đáng tin cậy nhất: nó cho trọn vẹn nội dung ngay lập tức và không phụ thuộc vào việc người dùng có bật phụ đề trên player hay không.

Ràng buộc của MV3 phải tính tới: `chrome.webRequest` **không đọc được response body**, và bản blocking đã bị gỡ khỏi MV3. Nên cơ chế gồm hai bước:

1. Một script chạy ở **MAIN world** vá `fetch` và `XMLHttpRequest` để ghi lại URL của file `.vtt` — cùng với JSON liệt kê các track phụ đề — khi trang gọi tới.
2. Service worker tự `fetch` URL đó kèm credentials rồi parse nội dung VTT.

**Đường dự phòng:** đọc `video.textTracks` ở chế độ `hidden`. Dùng khi việc bắt request không thành — ví dụ phụ đề đã nằm trong cache của trang nên không có request nào phát ra để mà bắt.

**Đã quan sát trên traffic thật (2026-09-20).** Udemy liệt kê phụ đề trong response của API bài giảng:

```
https://lg.udemy.com/api-2.0/users/me/subscribed-courses/{courseId}/lectures/{lectureId}/
    ?fields[lecture]=asset,...&fields[asset]=...,captions,...
```

URL nằm ở `asset.captions[]`, mỗi phần tử có `url`, `locale_id`, `video_label` và `source`. Bản thân file phụ đề có dạng:

```
https://vtt-c.udemycdn.com/{assetId}/{locale_id}/{yyyy-mm-dd_hh-mm-ss}-{hash}.vtt
    ?Expires=...&Signature=...&Key-Pair-Id=...
```

Bốn điểm rút ra, đều ảnh hưởng tới code:

- **URL ký ngắn hạn.** `Expires` quan sát được chỉ cách thời điểm gọi vài giờ, và mỗi lần ký lại cho `Signature` khác. Không cache qua phiên; phải fetch ngay sau khi bắt được.
- **Segment locale là dấu hiệu nhận dạng.** Đường dẫn luôn có `/{locale_id}/` ngay trước tên file. Đây là thứ phân biệt phụ đề với các file `.vtt` khác của Udemy.
- **Có bẫy `.vtt` không phải phụ đề.** Trang cũng tải `https://mp4-c.udemycdn.com/{...}/{n}/thumb-sprites.vtt` — track ảnh xem trước của thanh tua. Nó là WebVTT hợp lệ, nội dung cue là toạ độ ảnh (`thumb-sprites.jpg#xywh=...`). Lọc theo đuôi `.vtt` đơn thuần sẽ nhận nhầm nó; `isCaptionUrlAllowed` vì thế bắt buộc có segment locale.
- **Ngôn ngữ gốc có thể không phải `en_US`.** Khoá học quan sát được có 8 track, tất cả `source: "auto"`, và bản tiếng Anh là `en_GB`. Việc so khớp ngôn ngữ phải theo tiền tố `en`, không phải giá trị chính xác.

Video phát qua HLS (`application/x-mpegURL`), nên player nhiều khả năng tự tạo TextTrack bằng script thay vì dùng thẻ `<track>`.

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

/** Một câu đã chuẩn bị xong nhưng chưa phát. */
interface Utterance {
  /** Số giây câu này chiếm ở tốc độ 1.0. Chính xác hay ước lượng
   *  thì xem knowsDurationAhead. */
  readonly duration: number
  /** Resolve khi đọc xong. Reject bằng AbortError nếu bị huỷ. */
  play(rate: number): Promise<void>
  cancel(): void
}

interface TTSProvider {
  readonly name: string
  /** false với engine chỉ ước lượng được thời lượng, như Web Speech. */
  readonly knowsDurationAhead: boolean
  isAvailable(): Promise<boolean>
  prepare(text: string, signal: AbortSignal): Promise<Utterance>
}
```

Mỗi segment chỉ có **một** bản dịch duy nhất, dùng chung cho phụ đề và giọng đọc. Mục 7 giải thích vì sao không cần tách làm hai.

`Utterance` tách việc *chuẩn bị* khỏi việc *phát* vì hai loại engine hoạt động khác nhau: Web Speech đọc thẳng và chỉ ước lượng được độ dài, còn VieNeu trả về audio nên biết chính xác từng mili giây. Scheduler chỉ cần `duration` trước khi quyết định co giãn, không cần biết bên dưới là loại nào.

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

### 6.5 Tổng hợp trước con trỏ phát

M1 gọi `prepare()` đúng vào khoảnh khắc câu bắt đầu. Với Web Speech việc đó gần như tức thời nên không lộ ra vấn đề gì. Với VieNeu thì có: mỗi câu tốn chừng 0.8 giây từ lúc gọi tới lúc có audio trong tay — 0.63s suy luận cho một câu 6 giây, cộng HTTP, base64 và giải mã. Giữ nguyên cách gọi đó thì **mọi** câu đều vào trễ chừng ấy, và vì mục 6.2 tính ngân sách từ `max(segment.start, now)` nên cái trễ lập tức biến thành tốc độ đọc cao hơn và video bị làm chậm thường xuyên — một khuyết tật đều đặn, không phải sự cố thỉnh thoảng.

Scheduler vì thế chuẩn bị trước **đúng một câu**: trong lúc đọc câu N, nếu câu kế tiếp đã dịch xong và bắt đầu trong vòng `PREFETCH_LEAD = 10` giây theo thời gian video, thì gọi `prepare()` cho nó ngay. Tới lượt, câu đó đã có sẵn `Utterance` và chỉ việc phát.

Đúng một câu, không sâu hơn. RTF 0.105 nghĩa là tổng hợp nhanh gấp mười lần thời gian thực, nên một bước đã dư sức bám kịp con trỏ phát; chuẩn bị sâu hơn chỉ nhân số câu bị vứt đi mỗi lần tua lên, và làm việc hủy bỏ rắc rối thêm mà không mua được gì.

Phần chuẩn bị trước chịu cùng generation counter với phần đang đọc: tua, tạm dừng, đổi bài đều hủy nó.

**Nạp nguội.** Lần tổng hợp đầu tiên sau khi server khởi động tốn thêm 4.3 giây nạp model. Mục 8 viết rằng quãng đó "trùng với lô dịch đầu tiên nên không cảm thấy" — điều đó chỉ đúng nếu có ai chủ động kích hoạt nó. Nên khi gắn vào một bài giảng, extension gửi một request tổng hợp bé và vứt kết quả đi.

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

**Endpoint:** `POST http://127.0.0.1:8770/v1/audio/speech`, giữ đúng dạng request của OpenAI. Có một hệ quả đáng nói: **một implementation `TTSProvider` duy nhất** phục vụ được cả server này lẫn API của OpenAI, nếu sau này muốn dùng đám mây. Chỉ khác base URL.

**Không dùng được server đi kèm `vieneu`.** Module `apps.openai_speech` trong gói pip hardcode `Vieneu(mode="v3turbo")` ở dòng 100 và không có biến môi trường nào đổi sang Nano. Turbo chậm hơn Nano khoảng sáu lần trên CPU, nên dự án tự viết một wrapper FastAPI mỏng tại `server/app.py`. Wrapper này cũng cho ba thứ mà bản gốc không có: nạp model lười đúng như thiết kế, trả thời lượng chính xác qua header `X-Audio-Duration` để scheduler khỏi phải giải mã audio mới biết, và chính sách CORS đúng cho origin của extension.

**Yêu cầu:**
- Server đặt header `Access-Control-Allow-Origin: chrome-extension://<id của extension>`.
- Extension khai báo `host_permissions: ["http://127.0.0.1/*"]` (match pattern bỏ qua port, nên khai báo này phủ mọi port).
- Request được phát đi từ service worker chứ không phải content script, để chúng chạy trên origin của extension và không chịu ràng buộc CSP của trang.

**Khả dụng:** scheduler dò server khi bắt đầu bài giảng và mỗi khi có lỗi. Khi không liên lạc được, extension rơi về `WebSpeechProvider` và **báo rõ trong bảng điều khiển** thay vì im lặng.

**Ghi chú về lượng tử hóa:** bản int8 của VieNeu nhanh hơn ~1.6 lần nhưng đòi AVX-512 VNNI / AVX-VNNI — các tập lệnh x86 mà Apple Silicon không có, và tài liệu cảnh báo sẽ cho ra audio méo nếu thiếu. Trên máy này chỉ đường fp32 dùng được. Núm điều chỉnh thay thế là tham số `steps`, đã chốt ở **8**.

### 8.1 Đóng gói

**Đã chọn native.** `server/app.py` chạy thẳng bằng Python trên máy, dưới một `launchd` user agent:

```bash
OMP_NUM_THREADS=2 PORT=8770 HOST=127.0.0.1 python app.py
```

`HOST=127.0.0.1` là bắt buộc chứ không phải mặc định tiện tay: nó giữ server trên loopback, đúng điều kiện mà miễn trừ mixed-content ở mục 4.2 dựa vào, và không để bất cứ thứ gì ngoài máy với tới.

**Docker vẫn dùng được, chỉ không phải mặc định.** `server/Dockerfile` và `docker-compose.yml` đã build và chạy thật, publish cổng ra `127.0.0.1:8770`, mount cache HuggingFace của host vào `/models` nên image 1.45GB không phải cõng thêm 269MB trọng số. Lý do không chọn: nó chậm hơn 2.7 lần trong khi thứ nó bán — môi trường tái lập, dễ chuyển máy — lại không được tiêu thụ trên một máy phục vụ một người. Khi nào cần dựng trên máy khác hoặc muốn gỡ sạch không để lại Python trên hệ thống thì nó đáng giá ngay.

**Mặc định phải là loopback, không phải `0.0.0.0`.** Bản `app.py` viết ở M1 đọc `HOST` từ môi trường và mặc định `0.0.0.0`, nghĩa là chạy `python app.py` tay — không set biến nào — sẽ mở server ra mọi interface. Đó đúng là thứ mục 4.2 bảo không được làm, và nó chỉ an toàn chừng nào người chạy nhớ set biến. Mặc định đổi thành `127.0.0.1`; ai muốn mở rộng thì phải nói ra.

**Số đo thật, không phải ước tính.** Bản thiết kế trước viết rằng Colima "không bị phạt nặng" vì là VM arm64 không giả lập kiến trúc. **Điều đó sai.** Đo trên cùng một đoạn 17.2 giây audio, cùng model Nano 8 bước, và — quan trọng — qua **đúng cùng một file `app.py`** để không lẫn tạp chất:

| Môi trường | Suy luận | RTF | Nạp nguội | RAM | CPU cho 1 giờ bài giảng |
|---|---|---|---|---|---|
| Native, thư viện trực tiếp, ép 2 luồng | 1.47s | 0.086 | — | — | ~5,2 phút |
| Native, qua `app.py` + HTTP | **1.79s** | **0.105** | 4.34s | 478 MB | ~6,3 phút |
| Docker qua Colima, VM 2 CPU | **4.89s** | **0.284** | 7.72s | 639 MB | ~17 phút |

**Container chậm hơn 2.7 lần** so với cặp đối chiếu đúng của nó (dòng giữa). Con số phải so là 1.79 với 4.89; so với dòng đầu sẽ ra 3.3 lần nhưng đó là so lệch cặp.

Số CPU không phải nguyên nhân: bản native ép xuống đúng 2 luồng còn *nhanh hơn* bản để mặc định. Nguyên nhân nhiều khả năng nằm ở chỗ khác — bản ONNX Runtime cho Linux arm64 trong container không với tới được các kernel tăng tốc của Apple mà bản macOS dùng được. Đây là giả thuyết hợp lý chứ chưa xác minh.

**Một chỉnh tinh miễn phí:** ép số luồng ONNX xuống 2 nhanh hơn để mặc định khoảng 18% (1.47s so với 1.79s). Tác vụ này bị phạt vì tranh chấp luồng chứ không hưởng lợi từ nhiều nhân. Nên đặt `OMP_NUM_THREADS=2` cho cả hai cách chạy.

**Hệ quả chấp nhận được.** RTF 0.284 vẫn thấp hơn 1.0 rất nhiều, nên cơ chế lookahead vẫn bám kịp video thoải mái. Cái giá thật là điện năng: TTS tốn gần gấp ba lần thời gian CPU, đáng để ý khi máy chạy pin. Đổi sang native chỉ là chạy cùng `app.py` theo cách khác, extension không phải sửa gì.

**Đã kiểm chứng khi dựng, ở cả hai cách chạy:**
- `/health` trả về `model_loaded: false` trước request đầu tiên — nạp lười hoạt động đúng thiết kế.
- CORS nhận `chrome-extension://*`, từ chối origin khác bằng 400.
- Cổng chỉ với tới được qua `127.0.0.1`, không qua IP LAN của máy.
- Header `X-Audio-Duration` trả về thời lượng chính xác, scheduler không cần giải mã audio mới biết.

### 8.2 WASM — trạng thái thật

Bản thiết kế đầu loại WASM với lý do sai, cần đính chính lại cho rõ.

Lý do cũ là kiến trúc flow-matching chạy 8–16 lượt suy luận mỗi câu nên mức phạt của WASM bị nhân lên. Nhưng sau khi chốt 8 bước, RTF đo được là **0.094**. Kể cả khi WASM chậm hơn 6 lần, con số đó mới lên ~0.56 — vẫn dưới 1.0. **Tốc độ không phải thứ chặn.**

Lý do thứ hai là phonemizer `sea-g2p` không có bản trình duyệt. Đúng về hiện trạng — npm không có gói nào — nhưng `sea-g2p` **viết bằng Rust** (83.5%, Apache-2.0), và Rust sang `wasm32` là đường đã trải sẵn với `wasm-pack`. Đây có lẽ là phần dễ port nhất trong cả stack chứ không phải bức tường.

Thứ còn lại là thật: **269MB trọng số ONNX** phải tải một lần, cache vào OPFS hoặc IndexedDB, rồi giữ trong bộ nhớ của tab. Nằm trong giới hạn của `onnxruntime-web` nhưng là cái giá nặng cho một tab trình duyệt.

Kết luận đã sửa: **VieNeu chạy WASM nhiều khả năng khả thi, chỉ là chưa ai làm.** Nó là một dự án port thực thụ, không phải việc cắm thư viện có sẵn.

**Quyết định:** không làm ở v1. Server native chạy được ngay hôm nay và cho bạn extension dùng được sớm. Đưa WASM thành một spike riêng ở v2, với danh sách cần xác minh trước khi cam kết:

1. `sea-g2p` biên dịch sang `wasm32-unknown-unknown`. **Đã khảo sát phụ thuộc** — ba thứ chặn đường, đều gỡ được nhưng phải fork:
   - `pyo3` với feature `extension-module`: lớp binding sang Python, không sang wasm được. Cần đưa vào feature flag và thêm `wasm-bindgen` thay thế.
   - `memmap2`: wasm32 không có memory-mapped file. Cần đổi sang nạp từ điển thẳng vào bộ nhớ.
   - `rayon`: đa luồng trên wasm đòi `wasm-bindgen-rayon` cùng header COOP/COEP. Đơn giản nhất là tắt, chấp nhận chậm hơn.

   `regex`, `fancy-regex`, `once_cell`, `unicode-normalization` đều tương thích wasm.
2. Ba đồ thị ONNX có nạp được trong `onnxruntime-web` không — kiểm tra opset và các toán tử ít gặp.
3. Trần bộ nhớ thực tế khi giữ 269MB trọng số trong offscreen document.
4. RTF đo thật trong trình duyệt, không phải ước tính.

Nếu spike đó thành công thì `WasmProvider` xoá luôn nhu cầu server, và `TTSProvider` đã sẵn interface để cắm vào mà không đụng phần lõi. Nếu thất bại ở bước 1 hoặc 3, đường lùi vẫn là model định dạng Piper `CSA v3` (74MB, RTF 0.061) — thấp hơn một bậc về chất lượng nhưng chắc chắn chạy được.

### 8.3 Audio đi từ server tới tai người nghe bằng đường nào

Mục 4.1 đã chốt request phải phát đi từ service worker. Lý do ghi ở đó là CSP của trang; còn một lý do nữa mạnh hơn: nếu nới CORS của server cho `https://lg.udemy.com` để content script gọi thẳng, thì **mọi** script chạy trên trang Udemy — kể cả script bên thứ ba mà Udemy nhúng — đều gọi được server TTS trên máy này. Giữ `Access-Control-Allow-Origin` chỉ nhận `chrome-extension://` là một ranh giới thật chứ không phải thủ tục.

Hệ quả là audio phải vượt ranh giới process:

```
service worker:  POST /v1/audio/speech → WAV bytes + X-Audio-Duration
                 → base64
                 → chrome.runtime.sendMessage
content script:  → Blob → blob: URL → HTMLAudioElement
```

`chrome.runtime.sendMessage` serialize bằng JSON chứ không phải structured clone, nên `ArrayBuffer` không sống sót qua đó. Base64 là ràng buộc, không phải một lựa chọn trong hai. Cái giá: 24 kHz, 16-bit, mono là 48 KB cho mỗi giây audio, nên một câu 6 giây thành 288 KB và base64 đẩy lên ~384 KB. Ở tần suất chừng mười câu một phút, con số đó không đáng kể.

**Phát bằng `HTMLAudioElement`, không phải `AudioBufferSourceNode`.** `playbackRate` của Web Audio tăng tốc bằng cách đọc sample nhanh hơn, tức đổi luôn cao độ; ở 1.4× giọng nghe như giọng chuột. `HTMLMediaElement.preservesPitch` mặc định bật và cho đúng thứ mục 6.2 vẫn luôn giả định là có: nhanh hơn mà giọng không méo.

**Handler trong service worker chỉ nhận `http://127.0.0.1:*`.** Cùng lý do với `isCaptionUrlAllowed` ở mục 4.5: không để một content script bị chiếm biến service worker thành proxy đi tới host bất kỳ.

### 8.4 Chuyển provider khi server không có ở đó

Mục 10 đòi rơi về Web Speech khi không liên lạc được server, và mục 8 đòi dò lại "mỗi khi có lỗi". Cách rẻ nhất để có cả hai mà không dạy scheduler biết tới hai engine: một `FallbackProvider` tự nó là một `TTSProvider`, bọc hai cái bên trong. Nó thử cái chính, hỏng thì đánh dấu là đang hỏng và chuyển sang cái dự phòng, rồi thử lại cái chính sau 30 giây. Scheduler không biết chuyện đó xảy ra, và toàn bộ logic chuyển đổi nằm trong một đơn vị thuần túy test được không cần trình duyệt.

Một điều phải nói thẳng trong giao diện: M1 đã chứng minh `speechSynthesis` hỏng trên chính máy phát triển này (xem `docs/superpowers/2026-09-20-m1-verification.md`). Nên ở đây "rơi về Web Speech" trên thực tế nhiều khả năng là **không có tiếng gì cả**. Thông báo vì thế phải nói rằng server TTS chưa chạy, chứ không nói "đang dùng giọng dự phòng" rồi để người dùng ngồi chờ một thứ không bao giờ tới.

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

**M2 — giọng thật.** `VieNeuProvider`, server cục bộ chạy native, `launchd` agent, `Dockerfile` kèm theo, dò khả dụng và cơ chế dự phòng. Kéo theo hai thứ không hiện ra cho tới khi có engine thật: tổng hợp trước con trỏ phát (mục 6.5) và đường audio xuyên process (mục 8.3).

**M3 — dùng được hằng ngày.** Cache IndexedDB, bảng điều khiển, lớp phụ đề tiếng Việt, trang options.

**M4 — mài các cạnh sắc.** Toàn bộ bảng xử lý lỗi, tinh chỉnh việc dọn cache, tinh chỉnh prompt giữ thuật ngữ.

## 13. Câu hỏi còn treo

1. **Trang gọi file phụ đề bằng `fetch` hay `XMLHttpRequest`?** Dạng endpoint và tên trường đã xác nhận xong ở M1 — xem mục 4.5. Còn treo đúng hai điểm: transport của request `.vtt` (hook hiện chỉ vá `fetch`, trong khi mục 4.5 yêu cầu vá cả hai), và liệu có khoá học nào chỉ nhúng phụ đề trong luồng HLS hay không. Vẫn là việc xác minh, không phải câu hỏi thiết kế.
2. **Spike WASM cho VieNeu có đáng làm sớm hơn v2 không?** Bốn bước xác minh nằm ở mục 8.2. Nếu chạy được thì bỏ hẳn được server — nhưng đó là công việc port, không phải cấu hình.

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
