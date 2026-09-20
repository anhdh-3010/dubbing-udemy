# M3a — kết quả kiểm chứng cache

Task 8 của plan `docs/superpowers/plans/2026-09-20-m3a-cache.md`. Viết ngày
2026-09-20, trên máy phát triển (macOS 26.6.1, arm64, `Darwin 25.6.0`).

## Kết luận

M3a **chưa** có một lần xem bài giảng Udemy thật nào trong phiên làm việc ghi
lại tài liệu này. Task 8 của plan yêu cầu nạp bản build vào Chrome, đăng nhập
Udemy, xem một bài giảng, đếm request mạng, mở IndexedDB, tua ngược và xoá
database — sáu bước đó (Step 1 đến Step 6 của brief) cần một người ngồi trước
trình duyệt với tài khoản Udemy đã đăng nhập. Không có cách nào để tự động hoá
chuyện đó từ phiên này, và chúng **không được thực hiện**.

Những gì phiên này thực sự làm là kiểm tra bằng automation trên máy: bộ test
đơn vị, typecheck, bộ e2e Playwright chạy Chrome thật (nhưng với một trang
fixture cục bộ, không phải Udemy thật), bản build production, và việc cache
thực sự có mặt trong bundle đã build. Tất cả những mục đó **đã được xác nhận**
và liệt kê ở mục dưới với bằng chứng cụ thể.

Vì vậy: câu khẩu hiệu của M3a — **"xem lại một bài giảng tốn 0 lời gọi
LLM trên bài giảng thật"** — có bằng chứng từ unit test và e2e test (chạy trên
fixture giả lập), nhưng **chưa có một quan sát thật nào trên Udemy** xác nhận
nó. Mục "Chưa chạy — và vì sao" bên dưới ghi rõ checklist để đóng khoảng trống
này, và cho tới khi checklist đó chạy, câu khẩu hiệu vẫn ở trạng thái "được hỗ
trợ bởi bằng chứng gián tiếp", không phải "đã quan sát".

## Đã xác nhận bằng automation, trên máy này

Đây là những điều có thể phát biểu là sự thật, vì phiên này tự chạy hoặc tự
kiểm tra trực tiếp — không suy ra từ nơi khác:

| Khâu | Bằng chứng |
|---|---|
| Bộ test đơn vị | **278 test xanh trên 24 file** (`npm test` từ `extension/`). Baseline trước M3a là 212 test trên 20 file — con số này do người giao việc cung cấp, không phải phiên này tự chạy `npm test` (bị cấm ở nhiệm vụ này) |
| Typecheck | `npm run typecheck` sạch, không báo lỗi — con số do người giao việc cung cấp |
| Bộ e2e Playwright | **4/4 test xanh trên Chrome thật**, với IndexedDB thật, gồm một test mới chứng minh: nói lại đúng một câu thì lần thứ hai **không** chạm tới server tổng hợp giả lập, còn một câu khác vẫn chạm tới nó. Toàn bộ log chạy nằm ở `.superpowers/sdd/2026-09-20-m3a-cache/task-7-report.md` — con số do người giao việc cung cấp, không phải phiên này tự chạy `npm run test:e2e` (bị cấm ở nhiệm vụ này) |
| Bản build production | `npm run build` chạy thành công. Kiểm tra trực tiếp trong phiên này: thư mục `extension/.output/chrome-mv3/` tồn tại, tổng dung lượng các file đo được là **33 948 byte (≈ 33.95 kB)**, và `background.js` riêng là **10 965 byte (≈ 10.97 kB)** |
| Cache có mặt thật trong bundle, không chỉ trong test | Kiểm tra trực tiếp bằng `grep` trên `.output/chrome-mv3/`: chuỗi `udemy-dubbing` (tên database IndexedDB) xuất hiện trong `background.js`; chuỗi `cache-lookup` xuất hiện cả trong `background.js` lẫn trong `content-scripts/content.js` |
| Server TTS cục bộ đang chạy | Kiểm tra trực tiếp bằng `curl` trong phiên này tới `http://127.0.0.1:8770/health`, trả về đúng `{"status":"ok","model_loaded":true,"voice":"Minh Quân","steps":8}` |

Ba dòng đầu (số test, typecheck, số e2e) là con số do người giao việc cung cấp
kèm brief, không phải phiên này tự chạy — nhiệm vụ này bị cấm chạy `npm test`
và bộ e2e. Ba dòng cuối (kích thước build, các chuỗi trong bundle, health
endpoint) là những gì phiên này **tự kiểm tra trực tiếp** bằng lệnh trên máy
này, độc lập với con số được cho.

## Chưa chạy — và vì sao

Toàn bộ Step 2 tới Step 6 của brief **không được thực hiện** trong phiên này.
Lý do: mỗi bước đòi một người ngồi trước Chrome, đã đăng nhập một tài khoản
Udemy thật, mở một bài giảng thật, đọc DevTools của service worker, và tương
tác trực tiếp với trình phát video. Không có công cụ nào trong phiên này làm
được việc đó thay cho một người.

Cụ thể, những điều **chưa được quan sát** — không suy ra, không giả định —
gồm:

- Số request tới Gemini khi xem một bài giảng thật lần đầu.
- Số request tới Gemini khi xem lại đúng bài giảng đó lần thứ hai (kỳ vọng
  theo thiết kế là 0, nhưng **chưa có con số thật nào đo được**).
- Số request `POST /v1/audio/speech` ở lần xem thứ nhất và thứ hai.
- Số bản ghi trong object store `translations` và `audio` của
  IndexedDB `udemy-dubbing`, và tổng dung lượng trên đĩa mà Chrome báo.
- Hành vi tua ngược về một câu đã nghe: có phát gần như tức thì không, có
  phát sinh request `/v1/audio/speech` mới không.
- Hành vi sau khi xoá database (`indexedDB.deleteDatabase('udemy-dubbing')`)
  rồi tải lại trang: lồng tiếng có chạy lại bình thường không, có notice lỗi
  nào hiện ra cho người xem không.

### Checklist để người dùng chạy sau

Các bước dưới đây chép lại nguyên văn từ brief Task 8 (Step 1–6), giữ đúng kỳ
vọng gốc, để khi có người ngồi trước trình duyệt thì việc chạy chỉ còn là làm
theo cơ học, không phải nghĩ lại thiết kế.

- [ ] **Bước 1 — Dựng bản build thật và nạp vào Chrome.**
  ```bash
  cd /Users/anhdh/dubbing/extension && npm run build
  ```
  Nạp `extension/.output/chrome-mv3` vào Chrome bằng "Load unpacked" (hoặc bấm
  Reload nếu đã nạp từ M2). Xác nhận server TTS đang chạy:
  ```bash
  curl -s http://127.0.0.1:8770/health
  ```

- [ ] **Bước 2 — Lần xem thứ nhất, đo nền.** Mở một bài giảng Udemy **chưa
  từng xem** trong lần chạy nào. Mở DevTools của service worker
  (`chrome://extensions` → Service worker). Trong Network, lọc
  `generativelanguage`. Ghi lại: số request tới Gemini, và số request
  `POST /v1/audio/speech` tới `127.0.0.1:8770`. Xem ít nhất 3 phút.

- [ ] **Bước 3 — Lần xem thứ hai, chứng minh cache có tác dụng.** Tải lại
  trang bài giảng đó. Xem lại đúng 3 phút đầu ấy. Kỳ vọng, và phải ghi lại
  **con số thật chứ không phải "đúng như mong đợi"**:
  - Request tới Gemini: **0**.
  - Request `POST /v1/audio/speech`: **0** cho những câu đã nghe ở Bước 2.
  - Câu đầu tiên phát ra nhanh hơn rõ rệt so với lần đầu.

- [ ] **Bước 4 — Kiểm tra cache trên đĩa.** Trong DevTools của service
  worker, tab Application → IndexedDB → `udemy-dubbing`. Ghi lại số bản ghi ở
  `translations` và `audio`, và tổng dung lượng mà Chrome báo.

- [ ] **Bước 5 — Kiểm tra đường tua ngược.** Tua ngược về một câu đã nghe rồi
  cho phát lại. Câu đó phải phát gần như tức thì, và Network không được có
  request `/v1/audio/speech` nào mới.

- [ ] **Bước 6 — Kiểm tra cache hỏng thì lồng tiếng vẫn chạy.** Trong console
  của service worker:
  ```js
  indexedDB.deleteDatabase('udemy-dubbing')
  ```
  rồi tải lại trang bài giảng. Lồng tiếng phải chạy bình thường (dịch lại từ
  đầu, tổng hợp lại từ đầu), không có notice lỗi nào hiện ra cho người xem.
  Đây là ràng buộc "cache không bao giờ được làm hỏng lồng tiếng", kiểm chứng
  trên thực tế chứ không phải trong test.

Sau khi chạy xong sáu bước trên, tài liệu này cần được cập nhật lại với ngày
chạy thật, phiên bản Chrome, mô tả bài giảng, và các con số thật thay cho
checklist — theo đúng quy tắc kế thừa từ M2 (Ruling 11 của milestone đó):
**không được ghi một quan sát mà không ai thực sự quan sát.**

## Việc còn lại

- Chạy checklist ở trên với một người dùng thật, tài khoản Udemy thật, và cập
  nhật lại tài liệu này với con số thật.
- Cho tới lúc đó, "Hoàn thành M3a" trong plan còn hai gạch đầu dòng chưa đánh
  dấu: lần xem Udemy thật với 0 request Gemini/tổng hợp, và lần xoá sạch
  IndexedDB rồi tải lại.
- Các mục ghi hoãn (defect nhỏ, không sửa trong M3a) nằm ở
  `docs/superpowers/2026-09-20-m3a-rulings.md`, mục "Constraints carried
  forward" và trong phần ghi các "minor (deferred)" được transcribe từ
  ledger thực thi.
- M3b (bảng điều khiển, phụ đề tiếng Việt, trang options) sẽ dùng
  `isCacheDisabled()` và khoá `cacheQuotaBytes` mà M3a cố ý để lại — xem cuối
  plan M3a.
