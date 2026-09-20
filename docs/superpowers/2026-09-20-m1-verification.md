# M1 — kết quả kiểm chứng trên Udemy thật

Task 16 của plan M1, chạy ngày 2026-09-20 trên một bài giảng thật.

## Kết luận

Bộ máy đồng bộ chạy đúng từ đầu đến khâu áp chót. Mắt xích duy nhất không
chứng minh được là **phát tiếng qua Web Speech** — và nó hỏng ở tầng Chrome,
ngoài phạm vi code.

Web Speech là engine plan **cố ý chọn tạm** để kiểm chứng bộ máy đồng bộ
trước khi đưa VieNeu vào ở M2. Nó đã làm xong việc của nó: mọi khâu phía
trước đều được xác nhận. Việc nó tự hỏng không làm mất giá trị đó, nhưng
có nghĩa là phần đồng bộ cuối cùng chưa được nghe bằng tai.

## Đã xác nhận hoạt động

| Khâu | Bằng chứng |
|---|---|
| Tiêm content script | Thông báo của extension hiện trên trang |
| Bắt URL phụ đề | Đi được tới khâu dịch, tức là đã có cue |
| `parseVtt` → `mergeCues` → `planBatches` | Có lô để gửi đi |
| Gửi sang service worker, đọc API key | Request tới Gemini xuất hiện |
| Gọi Gemini | POST tới `generativelanguage.googleapis.com` |

Suy ra: hook bắt phụ đề dùng `fetch` chứ không phải `XMLHttpRequest` — nếu
là XHR thì hook đã mù và không bao giờ có cue để đi tiếp.

## Chưa xác nhận

- Ducking âm thanh gốc, co giãn tốc độ video, độ khớp thực tế — đều phụ
  thuộc vào việc nghe được tiếng.
- Đổi bài giảng giữa chừng (cơ chế `lectureChanged`, generation counter).
- Có khoá học nào chỉ nhúng phụ đề trong luồng HLS hay không.

## Web Speech hỏng như thế nào

Gọi thẳng từ Console, không qua extension:

```js
speechSynthesis.speak(new SpeechSynthesisUtterance("xin chào"))
```

Engine không bắn `onstart`, không `onerror`, không gì cả — hết 8 giây vẫn im.
Trong khi đó:

- `getVoices()` trả về **hai** giọng Việt: `Linh` và `Linh (Nâng cao)`
- Web Audio phát được tiếng bíp bình thường (`AudioContext.state === "running"`)
- Loa và thiết bị ra âm thanh đều ổn

Nên: loa ổn, trình duyệt ổn, giọng có sẵn, chỉ riêng hàng đợi
`speechSynthesis` bị kẹt. Nguyên nhân nằm ở Chrome/macOS, không ở code.

**Hệ quả cho M2:** VieNeu không chỉ là nâng cấp chất lượng giọng — nó là
đường thoát khỏi một engine đã chứng minh là không đáng tin trên chính máy
phát triển. Server đã dựng xong ở `server/app.py`, trả `X-Audio-Duration`
chính xác, và phát qua Web Audio — đường vừa được chứng minh là thông.

## Sáu lỗi do dữ liệu thật phát hiện

Không lỗi nào trong số này bị 148 unit test hay 49 mục ghi hoãn bắt được.

1. **`lg.udemy.com`** — trang bài giảng không nằm ở `www.udemy.com`.
   `matches` chỉ khai `www` nên **content script chưa từng được tiêm**.
   Extension nằm im hoàn toàn, không dấu hiệu lỗi. Xem spec mục 4.4b.
2. **`thumb-sprites.vtt`** — track ảnh xem trước của thanh tua cũng là
   WebVTT hợp lệ và lọt qua allowlist. Nội dung cue là toạ độ ảnh; nếu
   không chặn thì Gemini được yêu cầu dịch toạ độ và Web Speech đọc lên.
   Phân biệt bằng segment locale trong đường dẫn.
3. **`gemini-2.5-flash-lite` đã bị khai tử** — trả 404 dù **vẫn xuất hiện
   trong `models.list`**. Danh sách model của Google không phải nguồn tin
   đáng tin về thứ key thực sự gọi được.
4. **Thông điệp lỗi của Google bị vứt đi** — `callOnce` chỉ đọc `res.status`.
   Chính Google đã nói rõ phải đổi sang model nào, mà code không chuyển ra.
5. **4xx bị retry vô ích** — 404 bị thử lại 3 lần mỗi lô kèm backoff.
6. **HTML trang options dị dạng** — thiếu `<head>` nên WXT chèn script vào
   trong thẻ `<meta>` void.

## Bài học về fixture

Lỗi số 2 lộ ra một điểm mù có hệ thống: fixture `/c/en.vtt` trong test được
bịa ra ở Task 11, **trước khi ai nhìn thấy URL Udemy thật**. Nó trông hợp lý
nhưng sai hình dạng, nên vừa che lỗi vừa chặn cách sửa — khi siết predicate
thì chính nó vỡ ở hai file.

Mutation testing được áp dụng khắp nơi trong plan này để chứng minh test
*có ý nghĩa*, và nó bắt được nhiều test rỗng thật. Nhưng nó không cứu được
khi **dữ liệu đầu vào của test sai ngay từ đầu** — test vẫn phân biệt được
đúng/sai trên một hình dạng không tồn tại.

## Việc còn lại

- Câu hỏi treo số 1 trong spec đã thu hẹp: còn transport (`fetch` vs `XHR`,
  nay đã suy ra là `fetch`) và khả năng có khoá học chỉ dùng HLS.
- `web-speech.ts` có một chú thích sai: nó ghi rằng macOS chỉ phơi ra một
  giọng Việt và bản Enhanced không có. Thực tế có cả hai, và `voice()` dùng
  `find()` nên đang lấy giọng thường. Sửa hai dòng, để M2 làm cùng lúc.
