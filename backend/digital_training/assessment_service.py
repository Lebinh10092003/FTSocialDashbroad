import copy
import io
import json
import os
import random
import re
import secrets
import unicodedata
from collections import Counter
from decimal import Decimal

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from openpyxl import load_workbook

from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id


def _key(value):
    text = str(value or "").strip().lower().replace("đ", "d")
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", text)


COLUMN_ALIASES = {
    "question_code": {"macauhoi", "questioncode", "questionid", "idcauhoi"},
    "variant": {"made", "de", "variant", "version", "phienban"},
    "order": {"stt", "socau", "cau", "questionnumber", "order"},
    "knowledge_type": {"loaicauhoi", "lythuyetthuchanh", "knowledgetype"},
    "type": {"loaicau", "kieucauhoi", "dangcau", "type", "questiontype"},
    "text": {"cauhoi", "noidungcauhoi", "noidung", "question", "text"},
    "correct": {"dapan", "dapandung", "correctanswer", "answer"},
    "points": {"diem", "sodiem", "points", "score"},
    "required": {"batbuoc", "required"},
    "explanation": {"giaithich", "huongdan", "explanation"},
    "media_url": {"hinhanh", "anh", "image", "imageurl", "anhvideominhhoa", "anhvideominhhoaneuco", "media", "mediaurl"},
    "answer_image_url": {"anhdapan", "anhdapanneuco", "answerimage", "answerimageurl"},
    "category": {"chude", "nhomcau", "nhom", "category", "topic"},
    "difficulty": {"dokho", "mucdo", "difficulty", "level"},
}
for position, letter in enumerate("ABCDE", start=1):
    COLUMN_ALIASES[f"option_{position}"] = {
        str(position),
        letter.lower(),
        f"phuongan{position}",
        f"phuongan{letter.lower()}",
        f"dapan{letter.lower()}",
        f"option{letter.lower()}",
        f"option{position}",
    }


def _column_name(value):
    normalized = _key(value)
    for canonical, aliases in COLUMN_ALIASES.items():
        if normalized in aliases:
            return canonical
    return ""


def _question_type(value):
    normalized = _key(value)
    if normalized in {"tracnghiem", "tracnghiemmotdapan", "singlechoice", "chonmot", "mcq", ""}:
        return "single_choice"
    if normalized in {"tracnghiemnhieudapan", "multiplechoice", "chonnhieu", "multiselect"}:
        return "multiple_choice"
    if normalized in {"traloingan", "shortanswer", "shorttext", "tuluanngan", "diendapan", "diennoidung"}:
        return "short_answer"
    if normalized in {"ghepnoi", "matching", "match"}:
        return "matching"
    if normalized in {"sapxepthutu", "ordering", "sorting", "reorder"}:
        return "ordering"
    if normalized in {"fileupload", "uploadtep", "noptep", "tailen"}:
        return "file_upload"
    if normalized in {"taianh", "uploadanh", "upload", "thuchanh", "ganlinktaianh", "diendapanganlink", "ganlink", "linkupload"}:
        return "practical_submission"
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


def _drive_reference(value):
    source = str(value or "").strip()
    if not source:
        return "", ""
    match = re.search(r"(?:/d/|[?&]id=)([a-zA-Z0-9_-]+)", source)
    if match:
        return match.group(1), source
    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", source):
        return source, f"https://drive.google.com/open?id={source}"
    return "", source


def _option_answer_key(value, option_keys):
    part = str(value or "").strip().upper()
    if part in option_keys:
        return part
    if part in "ABCDE":
        numeric = str(ord(part) - ord("A") + 1)
        return numeric if numeric in option_keys else ""
    return ""


def _header_row(sheet):
    # Some valid XLSX generators omit worksheet ``<dimension>`` metadata.
    # In read-only mode openpyxl then leaves max_row/max_column as None until
    # the worksheet is scanned explicitly.
    if sheet.max_row is None:
        sheet.calculate_dimension(force=True)
    for row_number in range(1, min(sheet.max_row, 12) + 1):
        columns = {_column_name(cell.value) for cell in sheet[row_number]}
        supporting_columns = {"question_code", "order", "type", "correct", "points", "option_1"}
        if "text" in columns and columns.intersection(supporting_columns):
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
            question_code = str(value("question_code") or "").strip() or f"{_key(sheet.title)[:12]}-{row_number:04d}"
            if question_type not in {"single_choice", "multiple_choice", "short_answer", "matching", "ordering", "practical_submission", "file_upload"}:
                errors.append(f"{sheet.title}!{row_number}: loại câu “{value('type')}” chưa được hỗ trợ.")
                continue
            options = []
            for position in range(1, 6):
                option_text = str(value(f"option_{position}") or "").strip()
                if option_text:
                    options.append({"key": str(position), "text": option_text})
            if question_type == "matching":
                for option in options:
                    pair = re.split(r"\s*(?:=>|→|\|)\s*", option["text"], maxsplit=1)
                    if len(pair) == 2 and all(pair):
                        option["text"], option["match_text"] = pair
                if options and not all(option.get("match_text") for option in options):
                    warnings.append(
                        f"{sheet.title}!{row_number}: nên nhập mỗi cặp ghép theo dạng “vế trái | vế phải” để người làm thấy đủ nội dung."
                    )
            correct_raw = str(value("correct") or "").strip()
            correct = []
            if question_type in {"single_choice", "multiple_choice"}:
                if len(options) < 2:
                    errors.append(f"{sheet.title}!{row_number}: câu trắc nghiệm cần ít nhất 2 phương án.")
                raw_parts = [part.strip() for part in re.split(r"[,;|]", correct_raw) if part.strip()]
                option_keys = {option["key"] for option in options}
                for part in raw_parts:
                    matched_key = _option_answer_key(part, option_keys)
                    if matched_key:
                        correct.append(matched_key)
                        continue
                    matched = next((option["key"] for option in options if _key(option["text"]) == _key(part)), None)
                    if matched:
                        correct.append(matched)
                correct = list(dict.fromkeys(correct))
                if question_type == "single_choice" and len(correct) != 1:
                    errors.append(f"{sheet.title}!{row_number}: cần đúng 1 đáp án A–E.")
                elif question_type == "multiple_choice" and not correct:
                    errors.append(f"{sheet.title}!{row_number}: can co it nhat 1 dap an dung.")
            elif question_type in {"short_answer", "matching", "ordering"} and correct_raw:
                separator = r"[|;]" if question_type == "short_answer" else r"[|]"
                correct = [part.strip() for part in re.split(separator, correct_raw) if part.strip()]
            media_file_id, media_url = _drive_reference(value("media_url"))
            answer_image_file_id, answer_image_url = _drive_reference(value("answer_image_url"))
            question = {
                "id": f"{_key(variant) or 'de'}-{_key(question_code) or row_number}",
                "question_code": question_code,
                "variant": variant,
                "order": int(_number(value("order"), len(questions) + 1)),
                "type": question_type,
                "text": text,
                "options": options,
                "correct_answers": correct,
                "points": _number(value("points"), 1),
                "required": _bool(value("required"), True),
                "explanation": str(value("explanation") or "").strip(),
                "image_url": media_url,
                "media_url": media_url,
                "media_file_id": media_file_id,
                "answer_image_url": answer_image_url,
                "answer_image_file_id": answer_image_file_id,
                "knowledge_type": str(value("knowledge_type") or "").strip(),
                "category": str(value("category") or "").strip(),
                "difficulty": str(value("difficulty") or "").strip(),
                "audience_group": sheet.title,
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
    numeric_keys = all(str(option.get("key") or "").isdigit() for option in options)
    item["options"] = [
        {"key": str(index + 1) if numeric_keys else chr(65 + index), "text": option.get("text", "")}
        for index, option in enumerate(arranged)
    ]
    item["correct_answers"] = [str(target_index + 1) if numeric_keys else chr(65 + target_index)]
    return item


def generate_variants_from_import(questions, variant_count=5, questions_per_variant=20, seed=None, structure=None):
    try:
        variant_count = int(variant_count)
        questions_per_variant = int(questions_per_variant)
    except (TypeError, ValueError):
        raise ValueError("Số mã đề và số câu mỗi đề phải là số nguyên.")
    if variant_count < 1 or variant_count > 200:
        raise ValueError('So ma de phai tu 1 den 200.')
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

    structured_rules = []
    for rule in structure or []:
        try:
            count = int(rule.get("count") or 0)
        except (TypeError, ValueError):
            raise ValueError("Số câu trong cơ cấu đề phải là số nguyên.")
        if count <= 0:
            continue
        structured_rules.append({
            "category": str(rule.get("category") or "").strip().casefold(),
            "difficulty": str(rule.get("difficulty") or "").strip().casefold(),
            "count": count,
        })
    if structured_rules and sum(rule["count"] for rule in structured_rules) != questions_per_variant:
        raise ValueError("Tổng số câu trong cơ cấu chủ đề/độ khó phải bằng số câu mỗi mã đề.")
    for rule in structured_rules:
        available = [question for question in unique_questions if (
            not rule["category"] or str(question.get("category") or "").strip().casefold() == rule["category"]
        ) and (
            not rule["difficulty"] or str(question.get("difficulty") or "").strip().casefold() == rule["difficulty"]
        )]
        if len(available) < rule["count"]:
            raise ValueError("Ngân hàng không đủ câu cho một dòng cơ cấu chủ đề/độ khó.")

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

    quotas = {}
    if not structured_rules:
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
        if structured_rules:
            for rule in structured_rules:
                ranked = [
                    question for question in unique_questions
                    if str(question["id"]) not in selected_ids
                    and (not rule["category"] or str(question.get("category") or "").strip().casefold() == rule["category"])
                    and (not rule["difficulty"] or str(question.get("difficulty") or "").strip().casefold() == rule["difficulty"])
                ]
                rng.shuffle(ranked)
                ranked.sort(key=lambda question: usage[str(question["id"])])
                if len(ranked) < rule["count"]:
                    raise ValueError("Các dòng cơ cấu đang chồng lấn và không đủ câu hỏi không trùng trong một mã đề.")
                for question in ranked[:rule["count"]]:
                    selected.append(question)
                    selected_ids.add(str(question["id"]))
        else:
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
            "structure": structured_rules,
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
            for key in (
                "id", "question_code", "order", "type", "knowledge_type", "text",
                "options", "points", "required", "image_url", "media_url",
                "media_file_id", "answer_image_url", "category", "difficulty",
            )
        })
    return sorted(result, key=lambda item: (item.get("order") or 0, item.get("id") or ""))


def _answer_text(value):
    if isinstance(value, list):
        return ";".join(str(item).strip() for item in value if str(item).strip())
    if isinstance(value, dict):
        return ";".join(
            f"{key}-{value[key]}"
            for key in sorted(value)
            if value[key] not in (None, "") and key not in {"link", "upload_id", "upload_file_id", "upload_url"}
        )
    return str(value or "").strip()


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
        answer_text = _answer_text(answer)
        correct = question.get("correct_answers") or []
        if question.get("type") == "single_choice":
            if correct and answer_text.upper() == str(correct[0]).strip().upper():
                score += points
        elif question.get("type") == "multiple_choice":
            actual_values = {part.strip().upper() for part in re.split(r"[,;|]", answer_text) if part.strip()}
            correct_values = {str(part).strip().upper() for part in correct if str(part).strip()}
            if correct_values and actual_values == correct_values:
                score += points
        elif question.get("type") == "short_answer":
            if correct:
                normalized = _key(answer_text)
                if normalized and normalized in {_key(value) for value in correct}:
                    score += points
            else:
                manual = True
        elif question.get("type") in {"matching", "ordering"}:
            if correct and _key(answer_text) in {_key(value) for value in correct}:
                score += points
            elif not correct:
                manual = True
        else:
            manual = True
    attempt.auto_graded_points = score
    attempt.score = score
    attempt.max_score = maximum
    attempt.manual_grading_required = manual
    return attempt


def _safe_sheet_title(value):
    title = re.sub(r"[\\/*?:\[\]]", "-", str(value or "").strip())
    return title[:100] or "Sheet"


def _safe_drive_name(value, fallback="Thư mục"):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", str(value or "").strip())
    name = re.sub(r"\s+", " ", name).strip(" .-")
    return name[:180] or fallback


def _drive_child_folder(service, parent_id, name):
    safe_name = _safe_drive_name(name)
    query_name = safe_name.replace(chr(39), chr(92) + chr(39))
    result = service.files().list(
        q=f"'{parent_id}' in parents and name = '{query_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields="files(id,name)",
        pageSize=1,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    existing = result.get("files", [])
    if existing:
        return existing[0]["id"]
    created = service.files().create(
        body={
            "name": safe_name,
            "parents": [parent_id],
            "mimeType": "application/vnd.google-apps.folder",
        },
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return created["id"]


def upload_assessment_file_to_drive(uploaded, assessment, attempt, question_id=""):
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        raise ValueError("Chưa cấu hình GOOGLE_SERVICE_ACCOUNT_JSON để tải tệp lên Google Drive.")
    info = json.loads(raw)
    info["private_key"] = str(info.get("private_key") or "").replace("\\n", "\n")
    credentials = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )
    service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    folder_id = assessment.drive_folder_id
    config = assessment.storage_config or {}
    if config.get("create_customer_folder", True):
        customer_name = config.get("customer_folder_name") or (
            assessment.partner.name if assessment.partner else assessment.title
        )
        folder_id = _drive_child_folder(service, folder_id, customer_name)
    if config.get("create_participant_folder", True):
        template = str(config.get("participant_folder_template") or "{participant_code} - {respondent_name}")
        values = {
            "participant_code": attempt.participant_code,
            "respondent_name": attempt.respondent_name,
            "email": attempt.email,
            "phone": attempt.phone,
            "variant": attempt.variant,
        }
        try:
            participant_name = template.format(**values)
        except (KeyError, ValueError):
            participant_name = f"{attempt.participant_code} - {attempt.respondent_name}"
        folder_id = _drive_child_folder(service, folder_id, participant_name)
    uploaded.seek(0)
    media = MediaIoBaseUpload(
        io.BytesIO(uploaded.read()),
        mimetype=str(uploaded.content_type or "application/octet-stream"),
        resumable=False,
    )
    result = service.files().create(
        body={"name": _safe_drive_name(f"{question_id} - {uploaded.name}", uploaded.name), "parents": [folder_id]},
        media_body=media,
        fields="id,webViewLink",
        supportsAllDrives=True,
    ).execute()
    return {"id": result.get("id", ""), "url": result.get("webViewLink", "")}


def _variant_sheet_title(prefix, variant):
    label = str(variant or "").strip()
    if _key(label).startswith('de'):
        label = label.split(maxsplit=1)[1] if ' ' in label else label
    return _safe_sheet_title(f"{prefix} {label}".strip())


def _assessment_output_layout(assessment):
    overview_title = "T\u1ed4NG QUAN"
    distribution_title = "PH\u00c2N \u0110\u1ec0"
    delete_log_title = "NH\u1eacT K\u00dd X\u00d3A"
    variants = variants_for(assessment)
    return {
        "overview": overview_title,
        "distribution": distribution_title,
        "delete_log": delete_log_title,
        "question_sheets": {variant: _variant_sheet_title("\u0110\u1ec0", variant) for variant in variants},
        "answer_sheets": {variant: _variant_sheet_title("B\u00c0I L\u00c0M", variant) for variant in variants},
    }


def prepare_assessment_google_sheet(assessment):
    spreadsheet_id = extract_spreadsheet_id(assessment.output_sheet_url)
    if not spreadsheet_id:
        raise ValueError("Chưa cấu hình Google Sheet đầu ra hợp lệ cho đợt kiểm tra.")
    service = build_sheets_service(None, {})
    layout = _assessment_output_layout(assessment)
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(sheetId,title))",
    ).execute()
    existing = {item.get("properties", {}).get("title") for item in metadata.get("sheets", [])}
    required = [layout["overview"], layout["distribution"], *layout["question_sheets"].values(), *layout["answer_sheets"].values(), layout["delete_log"]]
    requests_body = [
        {"addSheet": {"properties": {"title": title, "gridProperties": {"rowCount": 1000, "columnCount": 250}}}}
        for title in required if title not in existing
    ]
    if requests_body:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": requests_body},
        ).execute()

    overview_values = [
        ["KI\u1ec2M TRA CU\u1ed0I KH\u00d3A T\u1eacP HU\u1ea4N", assessment.title],
        ["Kh\u00e1ch h\u00e0ng", assessment.partner.name if assessment.partner else ""],
        ["Nh\u00f3m \u0111\u1ed1i t\u01b0\u1ee3ng", assessment.audience_group],
        ["S\u1ed1 ng\u01b0\u1eddi", len(assessment.participants or [])],
        ["S\u1ed1 m\u00e3 \u0111\u1ec1", len(variants_for(assessment))],
        ["Tr\u1ea1ng th\u00e1i", assessment.status],
    ]
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{layout['overview']}'!A1",
        valueInputOption="RAW",
        body={"values": overview_values},
    ).execute()

    attempt_statuses = {}
    for item in assessment.attempts.order_by("started_at").values("participant_code", "status"):
        code = str(item.get("participant_code") or "").strip().casefold()
        if code:
            attempt_statuses[code] = item.get("status") or ""
    status_names = {"in_progress": "Đang làm", "submitted": "Đã nộp", "timed_out": "Hết giờ"}
    participant_values = [["M\u00e3 ng\u01b0\u1eddi l\u00e0m", "H\u1ecd t\u00ean", "Email", "S\u1ed1 \u0111i\u1ec7n tho\u1ea1i", "Nh\u00f3m", "M\u00e3 \u0111\u1ec1", "Tr\u1ea1ng th\u00e1i"]]
    participant_values.extend([
        [item.get("code", ""), item.get("name", ""), item.get("email", ""), item.get("phone", ""), item.get("group", ""), item.get("variant", ""), status_names.get(attempt_statuses.get(str(item.get("code") or "").strip().casefold(), ""), "Ch\u01b0a l\u00e0m")]
        for item in assessment.participants or []
    ])
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{layout['distribution']}'!A1",
        valueInputOption="RAW",
        body={"values": participant_values},
    ).execute()

    question_headers = ["STT", "M\u00e3 c\u00e2u h\u1ecfi", "Ch\u1ee7 \u0111\u1ec1", "Lo\u1ea1i c\u00e2u h\u1ecfi", "Ki\u1ec3u c\u00e2u h\u1ecfi", "\u0110\u1ed9 kh\u00f3", "C\u00e2u h\u1ecfi", "\u1ea2nh/Video minh h\u1ecda", "Ph\u01b0\u01a1ng \u00e1n 1", "Ph\u01b0\u01a1ng \u00e1n 2", "Ph\u01b0\u01a1ng \u00e1n 3", "Ph\u01b0\u01a1ng \u00e1n 4", "Ph\u01b0\u01a1ng \u00e1n 5", "\u0110\u00e1p \u00e1n", "\u1ea2nh \u0111\u00e1p \u00e1n", "\u0110i\u1ec3m"]
    for variant, sheet_title in layout["question_sheets"].items():
        rows = [question_headers]
        for question in sorted([item for item in assessment.questions if str(item.get("variant") or "") == variant], key=lambda item: item.get("order") or 0):
            option_map = {str(item.get("key")): item.get("text", "") for item in question.get("options") or []}
            rows.append([
                question.get("order", ""), question.get("question_code", ""), question.get("category", ""), question.get("knowledge_type", ""), question.get("type", ""), question.get("difficulty", ""), question.get("text", ""), question.get("media_url", ""),
                *[option_map.get(str(index), option_map.get(chr(64 + index), "")) for index in range(1, 6)],
                ";".join(str(item) for item in question.get("correct_answers") or []), question.get("answer_image_url", ""), question.get("points", 0),
            ])
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_title}'!A1",
            valueInputOption="RAW",
            body={"values": rows},
        ).execute()

    for variant, sheet_title in layout["answer_sheets"].items():
        question_count = len([item for item in assessment.questions if str(item.get("variant") or "") == variant])
        headers = ["M\u00e3 l\u01b0\u1ee3t l\u00e0m", "M\u00e3 ng\u01b0\u1eddi l\u00e0m", "H\u1ecd t\u00ean", "Email", "M\u00e3 \u0111\u1ec1", "Tr\u1ea1ng th\u00e1i", *[f"C\u00e2u {index}" for index in range(1, question_count + 1)], "\u0110i\u1ec3m t\u1ef1 \u0111\u1ed9ng", "\u0110i\u1ec3m th\u1ef1c h\u00e0nh", "T\u1ed5ng \u0111i\u1ec3m", "Link s\u1ea3n ph\u1ea9m", "File ID minh ch\u1ee9ng", "Tr\u1ea1ng th\u00e1i ch\u1ea5m", "Tr\u1ea1ng th\u00e1i \u0111\u1ed3ng b\u1ed9", "Th\u1eddi \u0111i\u1ec3m ghi Sheet", "H\u1ea1n x\u00f3a d\u1eef li\u1ec7u t\u1ea1m"]
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_title}'!A1",
            valueInputOption="RAW",
            body={"values": [headers]},
        ).execute()
    deletion_headers = [["M\u00e3 l\u01b0\u1ee3t l\u00e0m", "M\u00e3 \u0111\u1ec1", "H\u00ecnh th\u1ee9c", "Ng\u01b0\u1eddi y\u00eau c\u1ea7u", "Vai tr\u00f2", "K\u1ebft qu\u1ea3 quy\u1ec1n", "Tr\u1ea1ng th\u00e1i", "Ghi ch\u00fa"]]
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{layout['delete_log']}'!A1",
        valueInputOption="RAW",
        body={"values": deletion_headers},
    ).execute()
    return service, spreadsheet_id, layout


def append_assessment_deletion_log(attempt, actor, mode, note=""):
    service, spreadsheet_id, layout = prepare_assessment_google_sheet(attempt.assessment)
    service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"'{layout['delete_log']}'!A:A",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [[
            str(attempt.access_token), attempt.variant, mode, actor, "Admin/System",
            "Hợp lệ", "Đã xóa", note,
        ]]},
    ).execute()


def sync_attempt_to_google_sheet(attempt):
    service, spreadsheet_id, layout = prepare_assessment_google_sheet(attempt.assessment)
    questions = sorted([
        item for item in attempt.assessment.questions
        if str(item.get("variant") or "") == attempt.variant
    ], key=lambda item: item.get("order") or 0)
    answer_values = [_answer_text(attempt.answers.get(str(item.get("id")), "")) for item in questions]
    product_links = []
    product_file_ids = []
    for item in questions:
        value = attempt.answers.get(str(item.get("id")), "")
        if isinstance(value, dict):
            product_links.extend(str(value.get(key) or "") for key in ("link", "upload_url") if value.get(key))
            if value.get("upload_file_id"):
                product_file_ids.append(str(value["upload_file_id"]))
    row = [
        str(attempt.access_token), attempt.participant_code, attempt.respondent_name, attempt.email,
        attempt.variant, attempt.status, *answer_values, float(attempt.auto_graded_points or 0),
        float(attempt.practical_score or 0) if attempt.practical_score is not None else "",
        float(attempt.score or 0), "\n".join(product_links), "\n".join(product_file_ids),
        "Cần chấm" if attempt.manual_grading_required else "Đã chấm",
        "Đã ghi", attempt.submitted_at.isoformat() if attempt.submitted_at else "",
        attempt.purge_after.isoformat() if attempt.purge_after else "",
    ]
    sheet_title = layout["answer_sheets"][attempt.variant]
    existing = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_title}'!A:A",
    ).execute().get("values", [])
    row_number = next(
        (index for index, values in enumerate(existing, start=1) if values and str(values[0]) == str(attempt.access_token)),
        None,
    )
    if row_number:
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_title}'!A{row_number}",
            valueInputOption="RAW",
            body={"values": [row]},
        ).execute()
    else:
        service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_title}'!A:A",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [row]},
        ).execute()
    return True
