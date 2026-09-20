# M2 — kết quả kiểm chứng trên Udemy thật

Task 10 của plan M2, chạy ngày 2026-09-20 trên một bài giảng thật.

## Kết luận

M2 đạt mục tiêu: **một bài giảng Udemy thật phát ra tiếng Việt bằng giọng VieNeu,
đồng bộ với video, không dừng hình.** Giọng nghe được là giọng nam `Minh Quân`,
tức là đường đi qua server cục bộ hoạt động thật chứ không rơi về Web Speech.

Hai câu hỏi treo từ M1 đã đóng được. Một mục quan trọng vẫn chưa xác nhận, và nó
được ghi rõ ở dưới thay vì bỏ qua.

## Đã xác nhận hoạt động

| Khâu | Bằng chứng |
|---|---|
| Server VieNeu là engine thật sự được dùng | Giọng nghe được là giọng **nam** (`Minh Quân`). Web Speech trên máy này chỉ có giọng nữ (`Linh`), nên giọng nam loại trừ được đường dự phòng |
| Warm-up che được toàn bộ chi phí nạp nguội | **Mọi câu đều vào đúng lúc, kể cả câu đầu tiên.** Thiết kế chỉ dám hứa "câu đầu trễ, các câu sau đúng" — thực tế tốt hơn dự đoán |
| Tổng hợp trước con trỏ phát (mục 6.5) | Các câu sau câu đầu không trễ đều — nếu prefetch không chạy thì mọi câu sẽ trễ khoảng 0.8 giây một cách đều đặn |
| Ducking (mục 6.3) | Âm gốc nhỏ lại trong lúc giọng Việt đọc |
| Huỷ khi tua giữa câu (mục 6.4) | Tua giữa lúc đang đọc: tiếng tắt ngay, không đọc nốt, không đọc chồng |
| **Đổi bài giảng không tải lại trang** | Bài mới tự lồng tiếng. Đây là câu hỏi M1 **chưa bao giờ xác nhận được** — Udemy dùng lại cùng một thẻ `<video>` giữa các bài, nên cơ chế `lectureChanged` là loại dễ hỏng âm thầm |
| Thông báo khi server không chạy (mục 8.4, 10) | Tắt server rồi tải lại trang: hiện đúng câu *"Server TTS ngừng trả lời. Giọng dự phòng của trình duyệt thường im lặng trên máy này — chạy lại server rồi tải lại trang."* |

## Một dự đoán của review được thực tế xác nhận

Plan ban đầu viết rằng khi tắt server sẽ thấy thông báo *"Chưa có giọng đọc: server
TTS không chạy"*. Vòng review toàn nhánh chứng minh câu đó **không thể xảy ra**:
chuỗi ấy chỉ hiện khi *cả hai* engine cùng không khả dụng, mà `WebSpeechProvider`
vẫn tự báo là khả dụng vì `getVoices()` có trả về giọng Việt. Plan bị sửa lại trước
lần chạy này.

Thực tế khớp: thông báo hiện ra đúng là câu của `onStatusChange`, không phải câu
plan viết ban đầu. Một lập luận thuần tuý trên code đã dự đoán đúng hành vi thật.

## Chưa xác nhận

- **Video có hồi phục âm lượng khi server tắt hay không.** Đây là mục quan trọng
  nhất còn thiếu. Vòng review cuối phát hiện `WebSpeechProvider.play()` không có
  hạn chót: vì `speechSynthesis` trên máy này không bắn sự kiện nào, scheduler sẽ
  chờ mãi một câu không bao giờ kết thúc và giữ âm gốc ở 10% cho tới hết bài giảng.
  Bản sửa thêm một watchdog để nó luôn tự thoát.

  Người kiểm chứng có mô tả "giọng video gốc bé hơn", nhưng câu đó đọc được theo hai
  cách ngược nhau — ducking bình thường lúc server còn chạy, hay đúng triệu chứng của
  lỗi lúc server đã tắt — và không làm rõ được trước khi phiên kết thúc. **Ghi là chưa
  xác nhận.** Cách kiểm lại: tắt server, tải lại trang, nghe xem tiếng giảng viên có
  ở âm lượng bình thường không.

- **Video có bị làm chậm không** (tầng nén thứ ba của mục 6.2). Không để ý kỹ.
  Có thể đơn giản là các bản dịch đều vừa khung thời gian nên tầng này không phải
  can thiệp lần nào.

- **Giọng dự phòng Web Speech có phát ra tiếng không.** Không kiểm riêng. M1 đã
  chứng minh nó câm trên máy này, và M2 không làm gì để đổi điều đó.

## Số đo thật

| | |
|---|---|
| RAM lúc rảnh, chưa nạp model | ~41–62 MB |
| RAM ngay sau một lần tổng hợp | ~350 MB |
| RAM 5 giây sau đó | vẫn ~350 MB |

Con số 478 MB trong spec là mức hoạt động, không phải mức thường trực: macOS nén
các trang của model lại khi tiến trình rảnh một lúc. Người dùng chấp nhận "478 MB
thường trực" khi chọn giữ model trong RAM — **cái giá thật nhỏ hơn thế**, và phương
án tự nhả model đã bị từ chối hoá ra mua được ít hơn tưởng.

Server xử lý **tuần tự**: hai request song song trả về ở 0.41s và 0.81s, cái thứ hai
đợi cái thứ nhất. Đo trong lúc thực thi, và chính con số này biến một nhận xét của
reviewer từ giả thuyết thành lỗi phải sửa (xem ruling 14).

## Một lỗi quy trình, không phải lỗi code

Lần nạp extension đầu tiên thất bại vì hai lý do chồng lên nhau, cả hai đều thuộc về
người hướng dẫn chứ không thuộc về code:

1. Thư mục `.output/chrome-mv3` đã build và xác minh xong lại **biến mất** trước khi
   người dùng kịp nạp. Chưa giải thích được. Nếu tái diễn thì đáng truy.
2. `.output` bắt đầu bằng dấu chấm nên Finder ẩn nó đi — người dùng không thấy thư
   mục để chọn trong hộp thoại "Load unpacked".

Khắc phục: build thêm một bản sao vào `extension/unpacked`, tên không có dấu chấm.
Bài học: một hướng dẫn thao tác tay cần được kiểm chứng ở đúng môi trường người dùng
thao tác, không chỉ ở terminal.

## Việc còn lại

- Xác nhận nốt mục "video hồi phục âm lượng khi server tắt" ở trên.
- `server/tts.sh` được viết trong lúc kiểm chứng, theo yêu cầu của người dùng, để
  bật/tắt server hằng ngày mà không phải nhớ cú pháp `launchctl`.
- Các mục ghi hoãn của M2 nằm ở `docs/superpowers/2026-09-20-m2-rulings.md`, mục
  "Constraints carried forward".
