import copy
import io
import random
import re
import secrets
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
    "category": {"chude", "nhomcau", "nhom", "category", "topic"},
    "difficulty": {"dokho", "mucdo", "difficulty", "level"},
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
                "category": str(value("category") or "").strip(),
                "difficulty": str(value("difficulty") or "").strip(),
                "source": f"{sheet.title}!{row_number}",
            }
            questions.append(question)
    if not usable_sheets:
        errors.append("Không tìm thấy cột “Câu hỏi” trong workbook.")
    variants = sorted({question["variant"] for question in questions}, key=str.casefold)
    counts = Counter(question["variant"] for question in questions)
    point_totals = {}
    for variant in variants:
        variant_questions = [question for question in questions if question["variant"] == variant]
        fingerprints = [_question_fingerprint(question) for question in variant_questions]
        if len(fingerprints) != len(set(fingerprints)):
            errors.append(f"{variant}: có câu hỏi bị trùng trong cùng một mã đề.")
        point_totals[variant] = sum(
            Decimal(str(question.get("points") or 0))
            for question in variant_questions
        )
    if len(variants) == 1:
        warnings.append("Workbook hiện có 1 mã đề. Có thể thêm cột “Mã đề” hoặc dùng mỗi sheet làm một đề.")
    if variants and len(set(counts.values())) > 1:
        warnings.append("Số câu giữa các mã đề chưa bằng nhau; hệ thống vẫn chia đề nhưng nên kiểm tra lại.")
    if variants and len(set(point_totals.values())) > 1:
        warnings.append("Tổng điểm giữa các mã đề chưa bằng nhau; nên điều chỉnh trước khi phát hành.")
    return {
        "source_name": source_name,
        "questions": questions,
        "variants": [{"name": name, "question_count": counts[name]} for name in variants],
        "question_count": len(questions),
        "errors": errors,
        "warnings": warnings,
    }


def _question_fingerprint(question):
    option_text = "|".join(_key(item.get("text")) for item in question.get("options") or [])
    return f"{_key(question.get('text'))}|{option_text}"


def _shuffle_options(question, rng, target_index):
    item = copy.deepcopy(question)
    if item.get("type") != "single_choice" or len(item.get("correct_answers") or []) != 1:
        return item
    options = item.get("options") or []
    correct_key = item["correct_answers"][0]
    correct_option = next((option for option in options if option.get("key") == correct_key), None)
    if not correct_option:
        return item
    distractors = [option for option in options if option is not correct_option]
    rng.shuffle(distractors)
    target_index = target_index % len(options)
    arranged = distractors[:]
    arranged.insert(target_index, correct_option)
    item["options"] = [
        {"key": chr(65 + index), "text": option.get("text", "")}
        for index, option in enumerate(arranged)
    ]
    item["correct_answers"] = [chr(65 + target_index)]
    return item


def generate_variants_from_import(questions, variant_count=5, questions_per_variant=20, seed=None):
    try:
        variant_count = int(variant_count)
        questions_per_variant = int(questions_per_variant)
    except (TypeError, ValueError):
        raise ValueError("Số mã đề và số câu mỗi đề phải là số nguyên.")
    if variant_count < 2 or variant_count > 10:
        raise ValueError("Số mã đề phải từ 2 đến 10.")
    if questions_per_variant < 1 or questions_per_variant > 200:
        raise ValueError("Số câu mỗi đề phải từ 1 đến 200.")

    unique_questions = []
    seen = set()
    duplicate_count = 0
    for question in questions:
        fingerprint = _question_fingerprint(question)
        if fingerprint in seen:
            duplicate_count += 1
            continue
        seen.add(fingerprint)
        unique_questions.append(question)
    if len(unique_questions) < questions_per_variant:
        raise ValueError(
            f"File nguồn chỉ có {len(unique_questions)} câu không trùng; "
            f"không đủ để tạo đề {questions_per_variant} câu."
        )

    seed = int(seed) if seed not in (None, "") else secrets.randbits(63)
    rng = random.Random(seed)
    strata = {}
    for question in unique_questions:
        key = (
            str(question.get("category") or "").strip().casefold(),
            str(question.get("difficulty") or "").strip().casefold(),
            str(question.get("type") or "").strip().casefold(),
            str(question.get("points") or 0),
        )
        strata.setdefault(key, []).append(question)

    total = len(unique_questions)
    raw_targets = {
        key: len(group) * questions_per_variant / total
        for key, group in strata.items()
    }
    quotas = {
        key: min(len(strata[key]), int(raw_targets[key]))
        for key in strata
    }
    while sum(quotas.values()) < questions_per_variant:
        candidates = [key for key in strata if quotas[key] < len(strata[key])]
        if not candidates:
            break
        rng.shuffle(candidates)
        selected_key = max(candidates, key=lambda key: raw_targets[key] - quotas[key])
        quotas[selected_key] += 1

    usage = {str(question["id"]): 0 for question in unique_questions}
    generated = []
    for variant_index in range(1, variant_count + 1):
        selected = []
        selected_ids = set()
        for key, group in strata.items():
            ranked = group[:]
            rng.shuffle(ranked)
            ranked.sort(key=lambda question: usage[str(question["id"])])
            for question in ranked[:quotas[key]]:
                selected.append(question)
                selected_ids.add(str(question["id"]))
        if len(selected) < questions_per_variant:
            remaining = [
                question for question in unique_questions
                if str(question["id"]) not in selected_ids
            ]
            rng.shuffle(remaining)
            remaining.sort(key=lambda question: usage[str(question["id"])])
            selected.extend(remaining[:questions_per_variant - len(selected)])
        rng.shuffle(selected)

        for order, source in enumerate(selected, start=1):
            source_id = str(source["id"])
            usage[source_id] += 1
            item = _shuffle_options(source, rng, order + variant_index - 2)
            item["source_question_id"] = source_id
            item["variant"] = f"Đề {variant_index}"
            item["order"] = order
            item["id"] = f"de{variant_index}-{order}-{_key(source_id)[:24]}"
            generated.append(item)

    warnings = []
    if duplicate_count:
        warnings.append(f"Đã bỏ {duplicate_count} câu trùng nội dung trong file nguồn.")
    if len(unique_questions) < variant_count * questions_per_variant:
        warnings.append(
            "File nguồn chưa đủ để các mã đề hoàn toàn khác nhau; "
            "hệ thống đã giảm trùng lặp giữa các mã ở mức thấp nhất."
        )
    return {
        "questions": generated,
        "variants": [
            {"name": f"Đề {index}", "question_count": questions_per_variant}
            for index in range(1, variant_count + 1)
        ],
        "question_count": len(generated),
        "source_question_count": len(unique_questions),
        "warnings": warnings,
        "generation_config": {
            "variant_count": variant_count,
            "questions_per_variant": questions_per_variant,
            "source_question_count": len(unique_questions),
            "seed": seed,
        },
    }


def google_sheet_export_url(url):
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", str(url or ""))
    if not match:
        raise ValueError("Đường dẫn Google Sheet không hợp lệ.")
    return f"https://docs.google.com/spreadsheets/d/{match.group(1)}/export?format=xlsx"


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
