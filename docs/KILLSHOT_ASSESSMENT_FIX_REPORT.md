# Killshot — Assessment grading: trùng link nội bộ + ghi chú theo câu

Nhánh: `fix/assessment-grading-colors` (tiếp tục lên trên commit `5a9bad7` của
Hestia — Việc 1+2 đã có sẵn ở đó, không đụng lại). Trạng thái: **Code xong +
test PASS, CHƯA push** — chờ Hestia review độc lập rồi báo Sin merge.

## Việc 3 — Phát hiện trùng đáp án link CÙNG 1 học viên

`backend/digital_training/assessment_views.py::_admin_attempt_payloads`:
trước đây `link_index`/`attempt_links` đã có sẵn dữ liệu (như brief mô tả)
nhưng vòng lặp build `warnings` chỉ so khớp với các attempt KHÁC
(`item["attempt_id"] != attempt.id`), bỏ sót trường hợp 2 câu khác nhau của
CHÍNH 1 học viên dán cùng 1 link.

Đã thêm: với mỗi dòng `(normalized, link, question_id)` của đúng 1 attempt,
nhóm thêm theo `normalized` trong CHÍNH `own_rows` (list `attempt_links[attempt.id]`
đã có sẵn, không query lại) — nếu có câu khác cùng `normalized` thì phát thêm
1 warning riêng, đánh dấu `"scope": "same_attempt"` (khác với case cũ giờ đổi
tên `"scope": "other_attempt"` để frontend phân biệt). Warning "same_attempt"
tái dùng đúng shape `matches` như warning cũ (`attempt_id`, `respondent_name`,
`question_id`, `question_order`) để frontend không cần code 2 kiểu dữ liệu
khác nhau, chỉ đổi câu chữ hiển thị theo `scope`.

**Test** (`test_assessment_grading_features.py`):
- `test_admin_payload_flags_duplicate_practical_link_within_the_same_attempt`
  (mới) — 1 học viên dán cùng link (khác `/` cuối, test luôn cả normalize)
  vào 2 câu thực hành → xác nhận CẢ 2 câu đều nhận warning `scope=same_attempt`,
  đúng chiều tham chiếu lẫn nhau, và KHÔNG có warning `other_attempt` nào lẫn vào.
- Test cũ `test_admin_payload_exposes_automatic_score_and_duplicate_practical_links`
  giữ nguyên, chỉ thêm 1 dòng assert `scope == "other_attempt"` để khoá lại
  hành vi cũ không bị đổi ý ngoài ý muốn.

## Việc 4 — Ghi chú người chấm tách theo từng câu

**Backend** (`assessment_views.py::assessment_result_grade`): thêm
`question_id` (string, có thể rỗng) đọc từ `request.data.get("question_id")`
vào note object khi lưu — field mới, không đổi field cũ nào. `grading_notes`
vẫn là `JSONField(default=list)` như cũ, không cần migration.

**Quyết định tự đề xuất** (theo đúng yêu cầu brief, note lại lý do): ghi chú
CŨ (đã lưu trước khi có `question_id`) đơn giản KHÔNG có key `question_id`
trong dict — không cần backfill/migrate dữ liệu cũ, giữ nguyên như brief đề
xuất. Frontend coi `note.question_id` rỗng/không có = "ghi chú chung (cũ)",
hiển thị riêng, không gán nhầm vào câu nào — chọn đúng hướng Hestia đề xuất vì
đơn giản nhất và không có rủi ro sai lệch dữ liệu lịch sử.

**Frontend** (`src/components/digital-training/TrainingAssessmentsAdmin.tsx`):
- State `gradingNote` (string, dùng chung mọi câu) → đổi thành
  `gradingNoteDrafts: Record<string, string>` (draft riêng theo `question.id`) —
  tránh việc gõ dở ghi chú cho câu A rồi lỡ tay bấm sang câu B mà chữ vẫn còn
  nguyên trong ô, dễ lưu nhầm câu.
- `saveGradingNote()` (không tham số) → `saveGradingNote(questionId, note)`,
  gửi kèm `question_id` lên API, chỉ xoá draft của đúng câu đó sau khi lưu
  thành công (không xoá draft các câu khác đang gõ dở).
- Khối UI "Ghi chú của người chấm" (gợi ý nhanh + textarea + nút lưu + danh
  sách ghi chú) chuyển từ 1 khối cố định NGOÀI vòng lặp câu vào BÊN TRONG
  `<article>` của từng `activeQuestion` — danh sách ghi chú hiển thị lọc
  đúng `note.question_id === question.id`.
- Thêm 1 khối RIÊNG, luôn hiện ở dưới (ngoài vùng theo-câu) chỉ liệt kê ghi
  chú CŨ không có `question_id` — "Ghi chú chung (cũ, trước khi ghi chú gắn
  theo từng câu)" — chỉ hiện khi thực sự có ghi chú cũ loại này (điều kiện
  `.some(...)`), không tự tạo khối rỗng gây rối giao diện.
- Điểm chưa tính đến (KHÔNG làm, ngoài phạm vi brief): reset toàn bộ
  `gradingNoteDrafts` khi mở lượt chấm mới (`chooseGrading`/hàm mở attempt) —
  giữ nguyên hành vi cũ (trước đây cũng reset `gradingNote` về `""` ở đúng chỗ
  này), chỉ đổi tên state cho khớp cấu trúc mới.

**Test đã chạy, chưa viết thêm test frontend riêng** (dự án này không có test
frontend tự động cho component này — kiểm tra bằng `tsc --noEmit` + `npm run
build` + 2 lint script sẵn có, đúng yêu cầu brief, không tự thêm framework
test frontend mới ngoài phạm vi).

Backend test mới: `test_grading_note_is_saved_per_question_and_old_general_notes_are_preserved`
— PATCH kèm `question_id`, xác nhận note mới có đúng `question_id`, note cũ
(tạo thủ công không có `question_id`) giữ nguyên không bị sửa/mất.

## Kết quả chạy thật

- `python manage.py test digital_training` → 6/6 PASS ở
  `test_assessment_grading_features.py` (3 test cũ + 3 test mới — 2 mới của
  Việc 3+4, 1 chỉnh nhẹ test cũ thêm assert `scope`).
- `python manage.py test digital_training work_schedule` (venv riêng
  `backend/.venv-killshot/`) → 91 test, **9 fail/error — xác nhận PRE-EXISTING,
  không liên quan thay đổi lần này**: đã tự tay `git stash` code của mình,
  chạy lại đúng 1 trong các test đó trên nhánh gốc `fix/assessment-grading-colors`
  (chưa có code Việc 3+4) → fail y hệt, rồi `git stash pop` khôi phục lại code.
  Toàn bộ 9 lỗi đều ở `digital_training/tests.py` (participant identity
  fields/access_token), không đụng gì tới `assessment_views.py`/
  `test_assessment_grading_features.py` mình sửa.
- `npx tsc --noEmit` → sạch, không lỗi.
- `npm run build` → thành công (chỉ có cảnh báo chunk size có sẵn từ trước,
  không liên quan).
- `npm run check:dialogs` + `npm run check:email-renderers` → sạch (2 phần
  còn lại của `npm run lint`, không chạy `tsc` lại lần 2 vì đã chạy riêng).

## Việc CHƯA làm / cần Hestia quyết định

1. **Chưa push** — theo đúng yêu cầu, đợi Hestia review trước.
2. Chưa test tay trên UI thật (không có Chrome/browser access trong phiên
   này khi làm việc này) — chỉ verify qua `tsc`/`build`/test backend. Nếu cần
   verify UI thật, cần Sin/Hestia tự thao tác hoặc giao lại task riêng.
3. Không thêm test tự động cho frontend (dự án chưa có sẵn framework test
   frontend cho component này) — nếu Hestia muốn có, cần quyết định thêm
   framework (Vitest/RTL) trước, ngoài phạm vi 2 việc được giao lần này.

Có gì không rõ hoặc cần đổi hướng, nhắn lại qua kênh này.
