# Killshot — Realtime Sheet <-> Web sync (Sheet -> Web direction)

Nhánh: `feature/sheet-web-realtime-sync` (từ `main`, KHÔNG đụng `fix/leader-review-summary`).
Trạng thái: **Code xong + test PASS, CHƯA push/merge** — chờ Hestia review theo đúng yêu cầu.

## Tóm tắt việc đã làm

Chiều Web → Sheet đã tự động sẵn (signal Django). Chiều Sheet → Web trước đây chỉ chạy khi
bấm nút "đồng bộ 2 chiều" hoặc lúc CI deploy. Việc này thêm đường tắt **realtime**: Apps Script
`onEdit` trên sheet "Lịch công tác" → gọi webhook → backend ghi ngay vào DB **đúng 1 dòng vừa
sửa** (không quét lại toàn bộ ~6000 dòng như `pull_from_sheet` cũ).

## A. Google Apps Script — `apps-script/sheet-sync/Code.gs`

- Trigger `onEditInstallable(e)` (installable trigger, không dùng simple trigger `onEdit(e)` vì
  `UrlFetchApp` cần quyền uỷ quyền mà simple trigger không xin được) — chỉ xử lý sheet đúng tên
  "Lịch công tác", bỏ qua các tab khác (kể cả `_SYNC_OUTBOX` để tránh vòng lặp).
- Với mỗi dòng bị sửa (kể cả paste nhiều dòng cùng lúc — có loop qua `e.range.getNumRows()`):
  tạo `event_id` (`Utilities.getUuid()`), đọc snapshot A:K của đúng dòng đó, ghi vào tab ẩn mới
  `_SYNC_OUTBOX` (cột: event_id, row, edited_at, values_json, status, response, processed_at),
  rồi gọi `UrlFetchApp.fetch` tới webhook kèm header `X-Sheet-Webhook-Secret`.
- Sau khi backend trả 200 → cập nhật dòng outbox thành `status=sent`. Lỗi (HTTP khác 200 hoặc
  exception fetch) → `status=error`, giữ nguyên payload để chạy tay `retryFailedOutboxRows()`
  sau (không có retry tự động lặp vòng — đúng tinh thần "chỉ đánh dấu xử lý sau khi backend trả
  200" trong brief; retry tự động định kỳ có thể thêm sau nếu cần, nhưng brief không yêu cầu).
- **Chưa dán được vào Script Editor thật của sheet** (không có quyền API deploy Apps Script) —
  file này chỉ lưu vết trong repo, cần Sin/Hestia tự dán tay vào Extensions → Apps Script của
  sheet `1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc`, tạo Script Properties
  `WEBHOOK_URL`/`WEBHOOK_SECRET`, rồi tạo trigger On-edit trỏ vào `onEditInstallable`. **Chưa
  test được với sheet thật** — chỉ test được phần backend (xem mục D).

### B. Trường hợp thêm dòng công việc mới trên sheet

Xử lý qua đúng cùng 1 đường: `onEditInstallable` không phân biệt "sửa dòng cũ" hay "dòng mới"
— cả hai đều gửi snapshot A:K của dòng đó lên webhook. Backend tự quyết định create/update dựa
trên `sync_uid` (xem mục C). Sau khi backend ingest xong, backend **tự gọi lại
`push_groups_to_sheet` cho đúng 1 nhóm (email, ngày) vừa nhận** (không sync toàn bộ) để ghi
`task_id` (sync_uid) ngược vào cột ẩn J/K của đúng dòng đó — tái dùng nguyên hàm
`push_groups_to_sheet` đã có sẵn trong `sheet_sync.py`, không viết lại.

## C. Backend Django (`backend/work_schedule/`)

**Refactor quan trọng trước khi thêm code mới** (`sheet_sync.py`): tách phần xử lý 1 dòng ra
khỏi `pull_from_sheet` thành hàm riêng `_ingest_row(offset, row, today)` — giữ nguyên 100% logic
gốc (parse task, gán status, tạo/update `WorkItem` theo `sync_uid`), chỉ khác là `pull_from_sheet`
giờ gọi hàm này trong vòng lặp (bulk), còn webhook gọi đúng 1 lần cho 1 dòng (không cần gọi lại
Google Sheets API để lấy dữ liệu — payload từ Apps Script đã có sẵn). Đây là điểm "tái dùng logic
parse đã có, thu hẹp phạm vi chỉ đúng 1 dòng" theo đúng yêu cầu — không viết lại parser.

**Model mới** `WorkScheduleSheetInboundEvent` (`models.py`): `event_id` (unique, chống xử lý
trùng khi Apps Script retry), `row_number`, `payload` (JSON, lưu nguyên snapshot values từ Apps
Script để trace/debug), `status` (processed/failed), `created_count`/`updated_count`, `error`,
`received_at`, `processed_at`. Migration: `0011_workschedulesheetinboundevent.py` (đã generate +
verify chạy được, không phải viết tay).

**Endpoint mới** `POST /api/work-schedule/sheet-webhook` (`views.py::work_schedule_sheet_webhook`,
đăng ký ở `urls.py`):
- Auth bằng secret header `X-Sheet-Webhook-Secret` so khớp biến môi trường mới
  `SHEET_WEBHOOK_SECRET` (đã thêm vào `.env.example`, kèm giải thích) bằng `hmac.compare_digest`
  (tránh timing attack) — **không** dùng `IsAuthenticated` (Apps Script không login được), đúng
  yêu cầu; view khai `authentication_classes([])` + `permission_classes([AllowAny])` để override
  default `IsAuthenticated` toàn cục của DRF (`config/settings.py`).
- Validate payload tối thiểu: `event_id`, `row` (int, >=2), `values` (list) — thiếu bất kỳ trường
  nào trả 400, không đoán.
- **Chống trùng khi Apps Script retry**: `get_or_create(event_id=...)` — nếu event đã tồn tại,
  trả lại luôn kết quả cũ (200, không xử lý lại), không tạo/sửa `WorkItem` lần 2. Có test riêng
  xác nhận việc gửi lại cùng `event_id` với nội dung KHÁC vẫn giữ nguyên dữ liệu lần đầu (không
  áp dụng đè).
- **Bọc `suppress_sheet_queue()` quanh phần ghi DB** (tái dùng nguyên context manager có sẵn ở
  `signals.py`, không viết lại) — có test riêng xác nhận việc ghi từ webhook KHÔNG tạo thêm dòng
  `WorkScheduleSheetChange` (tức không kích hoạt lại luồng đẩy ngược ra Sheet, đúng yêu cầu chống
  vòng lặp `Sheet → Web → Sheet → ...`).
- Sau khi ingest xong (nếu có nhóm (email, ngày) bị đụng tới): gọi lại `_service()` +
  `ensure_sync_columns()` + `push_groups_to_sheet(service, touched, force=True)` để ghi ngược
  `task_id`/hash vào cột J/K của đúng dòng — **nếu bước ghi ngược này lỗi (ví dụ Sheets API hết
  quota), webhook KHÔNG fail toàn bộ** — dữ liệu đã ingest vào DB vẫn được giữ (status vẫn
  `processed`), chỉ trả thêm `pushBackError` trong response + ghi log, để không mất dữ liệu vừa
  nhận chỉ vì bước ghi ngược (thứ yếu) gặp sự cố. Có test riêng xác nhận hành vi này.

## D. Test (`backend/work_schedule/tests.py`)

Thêm class `WorkScheduleSheetWebhookTests` (6 test case, theo đúng style `TestCase` sẵn có,
không mock quá tay — chỉ mock 3 hàm gọi Google Sheets API thật `_service`/`ensure_sync_columns`/
`push_groups_to_sheet`, phần logic DB chạy thật):
1. Từ chối request thiếu/sai `X-Sheet-Webhook-Secret` (401), không đụng DB.
2. Sửa 1 dòng hợp lệ → tạo đúng 1 `WorkItem`, gọi đúng 1 lần `push_groups_to_sheet` với đúng
   nhóm (email, ngày) vừa tạo.
3. Ingest từ Sheet KHÔNG tạo thêm dòng `WorkScheduleSheetChange` (không vòng lặp ngược).
4. Gửi lại đúng `event_id` lần 2 (dù payload khác) → không xử lý lại, dữ liệu giữ nguyên lần đầu.
5. Payload thiếu trường bắt buộc → 400, không đụng Sheets API.
6. Ghi ngược lên Sheet lỗi (`push_groups_to_sheet` raise) → webhook vẫn trả 200, dữ liệu đã
   ingest không mất, có `pushBackError` trong response.

**Phát hiện đáng lưu ý trong lúc viết test** (không phải bug, nhưng dễ gây nhầm lẫn cho ai đọc
lại sau): migrations `0004/0006/0009/0010` của app này là **data migration seed dữ liệu lịch sử
thật** (tuần 37-39, có cả `sondc@fermat.edu.vn`) — nghĩa là MỌI test DB mới tạo ra đã có sẵn
`WorkItem`/`WorkScheduleSheetChange` không rỗng. Test ban đầu viết theo thói quen
`assertFalse(WorkItem.objects.exists())`/`.get(executor_id=...)` không lọc theo `source_sheet_row`
bị FAIL sai (không phải bug code, mà bug test) vì đụng trúng dữ liệu seed thật. Đã sửa toàn bộ
test sang lọc theo `source_sheet_row=ROW_NUMBER` cố định + xoá dữ liệu ở đúng dòng đó trong
`setUp()` trước khi test — an toàn với mọi lần seed dữ liệu sau này.

**Kết quả chạy thật** (venv riêng `backend/.venv-killshot/`, cài từ `requirements.txt`):
- `python manage.py test work_schedule` → **24/24 PASS** (18 test cũ + 6 test mới), không sửa gì
  ở 18 test cũ ngoài thêm import cần thiết.
- `python manage.py test` (toàn backend) → 228 test, 11 fail/error — **toàn bộ nằm ở
  `attendance`/`digital_training`, KHÔNG liên quan gì tới `work_schedule`** (đã xác nhận qua
  `git diff --stat main` — nhánh này chỉ đụng file trong `work_schedule/` + `.env.example`, không
  chạm `attendance/`/`digital_training/`) — kết luận đây là lỗi có sẵn trên `main`, không phải do
  thay đổi lần này gây ra. Không tự sửa (ngoài phạm vi được giao).

## Việc CHƯA làm / cần Hestia quyết định

1. **Chưa dán Code.gs vào Script Editor thật + chưa test với sheet/webhook thật** (không có
   quyền deploy Apps Script tự động) — cần Sin/Hestia tự dán tay + tạo Script Properties + trigger,
   theo hướng dẫn ở đầu file `Code.gs`.
2. **Chưa tạo `SHEET_WEBHOOK_SECRET` thật** (chỉ mới thêm placeholder vào `.env.example`) — cần
   sinh giá trị thật, set ở cả backend (biến môi trường production) lẫn Script Properties của
   Apps Script cho khớp.
3. **Chưa commit/push** — theo đúng yêu cầu "commit rồi báo lại review trước khi push/merge".
   Đã commit local trên nhánh `feature/sheet-web-realtime-sync`, CHƯA push lên remote.
4. Không có retry tự động định kỳ cho các dòng outbox lỗi (chỉ có hàm `retryFailedOutboxRows()`
   chạy tay) — nếu cần tự động, có thể thêm time-based trigger sau, nhưng brief không yêu cầu nên
   chưa làm để tránh vượt phạm vi.

Có gì không rõ hoặc cần đổi hướng, nhắn lại qua kênh này.
