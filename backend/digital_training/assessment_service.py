import io
import re
import unicodedata
from collections import Counter
from decimal import Decimal

import requests
from openpyxl import load_workbook


def _key(value):
    text = str(value or "").strip().lower().replace("đ", "d")
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", text)


COLUMN_ALIASES = {
    "variant": {"made", "de", "variant", "version", "phienban"},
    "order": {"stt", "socau", "cau", "questionnumber", "order"},
    "type": {"loaicau", "dangcau", "type", "questiontype"},
    "text": {"cauhoi", "noidungcauhoi", "noidung", "question", "text"},
    "correct": {"dapan", "dapandung", "correctanswer", "answer"},
    "points": {"diem", "sodiem", "points", "score"},
    "required": {"batbuoc", "required"},
    "explanation": {"giaithich", "huongdan", "explanation"},
    "image_url": {"hinhanh", "anh", "image", "imageurl"},
}
for letter in "ABCDE":
    COLUMN_ALIASES[f"option_{letter}"] = {
        letter.lower(),
        f"phuongan{letter.lower()}",
        f"dapan{letter.lower()}",
        f"option{letter.lower()}",
    }


def _column_name(value):
    normalized = _key(value)
    for canonical, aliases in COLUMN_ALIASES.items():
        if normalized in aliases:
            return canonical
    return ""


def _question_type(value):
    normalized = _key(value)
    if normalized in {"tracnghiem", "singlechoice", "multiplechoice", "chonmot", "mcq", ""}:
        return "single_choice"
    if normalized in {"traloingan", "shortanswer", "shorttext", "tuluanngan"}:
        return "short_answer"
    if normalized in {"taianh", "uploadanh", "fileupload", "upload", "thuchanh"}:
        return "file_upload"
    return normalized


def _bool(value, default=True):
    if value in (None, ""):
        return default
    return _key(value) not in {"0", "false", "no", "khong", "khongbatbuoc"}


def _number(value, default=1):
    try:
        return max(0, float(value))
    except (TypeError, ValueError):
        return default


def _header_row(sheet):
    for row_number in range(1, min(sheet.max_row, 12) + 1):
        columns = {_column_name(cell.value) for cell in sheet[row_number]}
        if "text" in columns:
            return row_number
    return None


def parse_assessment_workbook(content, source_name=""):
    workbook = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    questions = []
    errors = []
    warnings = []
    usable_sheets = []
    for sheet in workbook.worksheets:
        header_row = _header_row(sheet)
        if header_row:
            usable_sheets.append((sheet, header_row))
    for sheet, header_row in usable_sheets:
        columns = {}
        for index, cell in enumerate(sheet[header_row], start=1):
            canonical = _column_name(cell.value)
            if canonical and canonical not in columns:
                columns[canonical] = index
        for row_number in range(header_row + 1, sheet.max_row + 1):
            def value(name):
                column = columns.get(name)
                return sheet.cell(row_number, column).value if column else None

            text = str(value("text") or "").strip()
            if not text:
                continue
            variant = str(value("variant") or (sheet.title if len(usable_sheets) > 1 else "Đề 1")).strip()
            question_type = _question_type(value("type"))
            if question_type not in {"single_choice", "short_answer", "file_upload"}:
                errors.append(f"{sheet.title}!{row_number}: loại câu “{value('type')}” chưa được hỗ trợ.")
                continue
            options = []
            for letter in "ABCDE":
                option_text = str(value(f"option_{letter}") or "").strip()
                if option_text:
                    options.append({"key": letter, "text": option_text})
            correct_raw = str(value("correct") or "").strip()
            correct = []
            if question_type == "single_choice":
                if len(options) < 2:
                    errors.append(f"{sheet.title}!{row_number}: câu trắc nghiệm cần ít nhất 2 phương án.")
                raw_parts = [part.strip() for part in re.split(r"[,;|]", correct_raw) if part.strip()]
                for part in raw_parts:
                    upper = part.upper()
                    if upper in {option["key"] for option in options}:
                        correct.append(upper)
                        continue
                    matched = next((option["key"] for option in options if _key(option["text"]) == _key(part)), None)
                    if matched:
                        correct.append(matched)
                if len(correct) != 1:
                    errors.append(f"{sheet.title}!{row_number}: cần đúng 1 đáp án A–E.")
            elif question_type == "short_answer" and correct_raw:
                correct = [part.strip() for part in re.split(r"[|;]", correct_raw) if part.strip()]
            question = {
                "id": f"{_key(variant) or 'de'}-{row_number}-{len(questions) + 1}",
                "variant": variant,
                "order": int(_number(value("order"), len(questions) + 1)),
                "type": question_type,
                "text": text,
                "options": options,
                "correct_answers": correct,
                "points": _number(value("points"), 1),
                "required": _bool(value("required"), True),
                "explanation": str(value("explanation") or "").strip(),
                "image_url": str(value("image_url") or "").strip(),
                "source": f"{sheet.title}!{row_number}",
            }
            questions.append(question)
    if not usable_sheets:
        errors.append("Không tìm thấy cột “Câu hỏi” trong workbook.")
    variants = sorted({question["variant"] for question in questions}, key=str.casefold)
    counts = Counter(question["variant"] for question in questions)
    if len(variants) == 1:
        warnings.append("Workbook hiện có 1 mã đề. Có thể thêm cột “Mã đề” hoặc dùng mỗi sheet làm một đề.")
    if variants and len(set(counts.values())) > 1:
        warnings.append("Số câu giữa các mã đề chưa bằng nhau; hệ thống vẫn chia đề nhưng nên kiểm tra lại.")
    return {
        "source_name": source_name,
        "questions": questions,
        "variants": [{"name": name, "question_count": counts[name]} for name in variants],
        "question_count": len(questions),
        "errors": errors,
        "warnings": warnings,
    }


def google_sheet_export_url(url):
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", str(url or ""))
    if not match:
        raise ValueError("Đường dẫn Google Sheet không hợp lệ.")
    gid_match = re.search(r"(?:[?#&]gid=)(\d+)", str(url))
    suffix = f"&gid={gid_match.group(1)}" if gid_match else ""
    return f"https://docs.google.com/spreadsheets/d/{match.group(1)}/export?format=xlsx{suffix}"


def fetch_google_sheet(url):
    response = requests.get(google_sheet_export_url(url), timeout=25)
    if response.status_code != 200:
        raise ValueError("Không thể đọc Google Sheet. Hãy bật quyền “Bất kỳ ai có đường liên kết đều có thể xem”.")
    content_type = response.headers.get("Content-Type", "")
    if "html" in content_type.lower():
        raise ValueError("Google Sheet đang yêu cầu đăng nhập hoặc chưa được chia sẻ.")
    return response.content


def variants_for(assessment):
    return sorted({str(item.get("variant") or "Đề 1") for item in assessment.questions}, key=str.casefold)


def public_questions(assessment, variant):
    result = []
    for item in assessment.questions:
        if str(item.get("variant") or "Đề 1") != variant:
            continue
        result.append({
            key: item.get(key)
            for key in ("id", "order", "type", "text", "options", "points", "required", "image_url")
        })
    return sorted(result, key=lambda item: (item.get("order") or 0, item.get("id") or ""))


def grade_attempt(attempt):
    questions = [
        item for item in attempt.assessment.questions
        if str(item.get("variant") or "Đề 1") == attempt.variant
    ]
    score = Decimal("0")
    maximum = Decimal("0")
    manual = False
    for question in questions:
        points = Decimal(str(question.get("points") or 0))
        maximum += points
        answer = attempt.answers.get(str(question.get("id")), "")
        correct = question.get("correct_answers") or []
        if question.get("type") == "single_choice":
            if correct and str(answer).strip().upper() == str(correct[0]).strip().upper():
                score += points
        elif question.get("type") == "short_answer":
            if correct:
                normalized = _key(answer)
                if normalized and normalized in {_key(value) for value in correct}:
                    score += points
            else:
                manual = True
        else:
            manual = True
    attempt.auto_graded_points = score
    attempt.score = score
    attempt.max_score = maximum
    attempt.manual_grading_required = manual
    return attempt
