"""Backend-only services for the Examination paper bank."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from io import BytesIO
from pathlib import Path

import requests
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.utils import timezone
from docx import Document
from jsonschema import Draft202012Validator
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader

from .models import AiProviderConfig, AiUsageLog, BlueprintSlot, ExamPaper, ExamQuestion, ExamSourceDocument

DIFFICULTIES = ('EASY', 'MEDIUM', 'HARD', 'VERY_HARD')
DIFFICULTY_LABELS = {'EASY': 'Dễ', 'MEDIUM': 'Trung bình', 'HARD': 'Khó', 'VERY_HARD': 'Rất khó'}
CHECK_STATUSES = {'PENDING', 'PASSED', 'AI_FIXED', 'NEEDS_REVIEW', 'WARNING'}
QUESTION_SCHEMA = {
    'type': 'object', 'required': ['content', 'choices', 'correctAnswer', 'difficulty', 'topic'],
    'properties': {
        'content': {'type': 'string', 'minLength': 3},
        'choices': {'type': 'array', 'minItems': 4, 'maxItems': 4, 'items': {'type': 'string', 'minLength': 1}},
        'correctAnswer': {'type': 'string', 'enum': ['A', 'B', 'C', 'D']},
        'explanation': {'type': 'string'},
        'difficulty': {'type': 'string', 'enum': list(DIFFICULTIES)},
        'topic': {'type': 'string'},
    },
}
QUESTION_VALIDATOR = Draft202012Validator(QUESTION_SCHEMA)


def _cipher() -> Fernet:
    key = os.getenv('AI_CONFIG_ENCRYPTION_KEY', '').strip()
    if not key:
        if not settings.DEBUG:
            raise ValueError('Thiếu AI_CONFIG_ENCRYPTION_KEY trên máy chủ.')
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt_secret(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode() if value else ''


def decrypt_secret(value: str) -> str:
    if not value:
        return ''
    try:
        return _cipher().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise ValueError('Không thể giải mã API key AI.') from exc


def masked_secret(value: str) -> str:
    if not value:
        return ''
    plain = decrypt_secret(value)
    return f'{plain[:4]}••••••••{plain[-4:]}' if len(plain) > 8 else '••••••••'


def default_distribution(total: int) -> dict[str, int]:
    total = max(0, int(total or 0))
    easy = total * 20 // 100
    hard = total * 20 // 100
    very_hard = total * 10 // 100
    return {'EASY': easy, 'MEDIUM': total - easy - hard - very_hard, 'HARD': hard, 'VERY_HARD': very_hard}


def validate_distribution(total: int, values: dict) -> dict[str, int]:
    normalized = {key: max(0, int((values or {}).get(key, 0) or 0)) for key in DIFFICULTIES}
    if sum(normalized.values()) != int(total or 0):
        raise ValueError('Tổng câu Dễ, Trung bình, Khó và Rất khó phải bằng tổng số câu.')
    return normalized


def normalize_question(value: dict, order: int = 1) -> dict:
    raw = dict(value or {})
    choices = raw.get('choices') or raw.get('options') or []
    if isinstance(choices, dict):
        choices = [choices.get(label, '') for label in 'ABCD']
    if isinstance(choices, list):
        choices = [str(item.get('text', '')) if isinstance(item, dict) else str(item) for item in choices]
    normalized = {
        'content': str(raw.get('content') or raw.get('question') or '').strip(),
        'choices': choices,
        'correctAnswer': str(raw.get('correctAnswer') or raw.get('correct_answer') or '').strip().upper(),
        'explanation': str(raw.get('explanation') or '').strip(),
        'difficulty': str(raw.get('difficulty') or 'MEDIUM').strip().upper(),
        'topic': str(raw.get('topic') or '').strip(),
        'order': int(raw.get('order') or order),
    }
    errors = sorted(QUESTION_VALIDATOR.iter_errors(normalized), key=lambda error: list(error.path))
    if errors:
        raise ValueError('Câu hỏi không hợp lệ: ' + '; '.join(error.message for error in errors[:3]))
    return normalized


def serialize_question(question: ExamQuestion) -> dict:
    return {
        'id': str(question.id), 'order': question.order, 'content': question.content,
        'choices': question.choices or [], 'correctAnswer': question.correct_answer,
        'explanation': question.explanation, 'difficulty': question.difficulty, 'topic': question.topic,
        'checkStatus': question.check_status, 'warnings': question.warnings or [], 'aiMetadata': question.ai_metadata or {},
        'blueprintSlotId': str(question.blueprint_slot_id or ''), 'questionType': question.question_type, 'score': float(question.score), 'slotMetadata': question.slot_metadata or {},
    }


def serialize_source(source: ExamSourceDocument) -> dict:
    return {
        'id': str(source.id), 'type': source.source_type, 'name': source.name,
        'fileUrl': source.file.url if source.file else '', 'referencedPaperId': str(source.referenced_paper_id or ''),
        'createdAt': source.created_at.isoformat(),
    }


def serialize_paper(paper: ExamPaper, include_questions: bool = False) -> dict:
    data = {
        'id': str(paper.id), 'title': paper.title, 'blueprintVersionId': str(paper.blueprint_version_id or ''), 'blueprintName': paper.blueprint_version.blueprint.name if paper.blueprint_version_id else 'Đề cũ chưa có ma trận', 'blueprintVersion': paper.blueprint_version.version_number if paper.blueprint_version_id else None,
        'competitionId': paper.competition_id or '', 'competitionName': paper.competition.name if paper.competition else '',
        'sessionId': paper.session_id or '', 'sessionName': paper.session.name if paper.session else '',
        'subject': paper.subject, 'gradeOrCategory': paper.grade_or_category, 'language': paper.language,
        'durationMinutes': paper.duration_minutes, 'totalQuestions': paper.total_questions,
        'difficultyDistribution': paper.difficulty_distribution or default_distribution(paper.total_questions),
        'status': paper.status, 'description': paper.description, 'aiGenerationStatus': paper.ai_generation_status,
        'aiGenerationMessage': paper.ai_generation_message, 'createdBy': paper.created_by, 'updatedBy': paper.updated_by,
        'createdAt': paper.created_at.isoformat(), 'updatedAt': paper.updated_at.isoformat(),
        'questionCount': paper.questions.count(),
    }
    if include_questions:
        data['questions'] = [serialize_question(item) for item in paper.questions.all()]
        data['sources'] = [serialize_source(item) for item in paper.sources.select_related('referenced_paper').all()]
    return data


def read_uploaded_source(uploaded) -> str:
    extension = Path(uploaded.name).suffix.lower()
    if extension not in {'.pdf', '.docx', '.xlsx'}:
        raise ValueError('Chỉ hỗ trợ tệp PDF, DOCX hoặc XLSX.')
    if uploaded.size > 15 * 1024 * 1024:
        raise ValueError('Mỗi tệp nguồn tối đa 15 MB.')
    content = uploaded.read()
    uploaded.seek(0)
    if extension == '.pdf':
        return '\n'.join((page.extract_text() or '') for page in PdfReader(BytesIO(content)).pages)[:120000]
    if extension == '.docx':
        return '\n'.join(paragraph.text for paragraph in Document(BytesIO(content)).paragraphs)[:120000]
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    rows = []
    for sheet in workbook.worksheets:
        rows.append(f'[{sheet.title}]')
        for row in sheet.iter_rows(values_only=True):
            values = [str(value).strip() for value in row if value not in (None, '')]
            if values:
                rows.append(' | '.join(values))
    return '\n'.join(rows)[:120000]


def source_context(paper: ExamPaper) -> str:
    chunks = []
    for source in paper.sources.select_related('referenced_paper').all():
        if source.source_type == 'PAPER' and source.referenced_paper:
            questions = '\n'.join(f'- {question.content}' for question in source.referenced_paper.questions.all()[:100])
            chunks.append(f'Đề tham chiếu: {source.referenced_paper.title}\n{questions}')
        elif source.extracted_text:
            chunks.append(f'Nguồn {source.name}:\n{source.extracted_text}')
    if paper.description:
        chunks.append(f'Yêu cầu bổ sung: {paper.description}')
    return '\n\n'.join(chunks)[:160000]


def _config() -> AiProviderConfig:
    return AiProviderConfig.objects.filter(provider='openai').first() or AiProviderConfig(provider='openai')


def serialize_ai_config(config: AiProviderConfig) -> dict:
    return {
        'provider': config.provider, 'baseUrl': config.base_url, 'apiKeyMasked': masked_secret(config.api_key_encrypted),
        'hasApiKey': bool(config.api_key_encrypted), 'generationModel': config.generation_model,
        'reviewModel': config.review_model, 'temperature': config.temperature, 'maxTokens': config.max_tokens,
        'timeoutSeconds': config.timeout_seconds, 'maxRetries': config.max_retries, 'updatedAt': config.updated_at.isoformat() if config.pk else '',
    }


def call_ai_json(*, paper: ExamPaper, task_type: str, model: str, system: str, prompt: str, user_email: str) -> dict:
    config = _config()
    api_key = decrypt_secret(config.api_key_encrypted)
    if not api_key:
        raise ValueError('Chưa cấu hình API key OpenAI. Vui lòng vào Cấu hình AI.')
    endpoint = config.base_url.rstrip('/') + '/chat/completions'
    started = time.monotonic()
    payload = {
        'model': model, 'temperature': config.temperature, 'max_tokens': config.max_tokens,
        'response_format': {'type': 'json_object'},
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}],
    }
    last_error = ''
    for attempt in range(config.max_retries + 1):
        try:
            response = requests.post(endpoint, headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}, json=payload, timeout=config.timeout_seconds)
            response.raise_for_status()
            body = response.json()
            content = body['choices'][0]['message']['content']
            parsed = json.loads(content)
            usage = body.get('usage') or {}
            AiUsageLog.objects.create(paper=paper, user_email=user_email, task_type=task_type, provider=config.provider, model=model, input_tokens=int(usage.get('prompt_tokens') or 0), output_tokens=int(usage.get('completion_tokens') or 0), duration_ms=int((time.monotonic() - started) * 1000), success=True)
            return parsed
        except Exception as exc:
            last_error = str(exc)
            if attempt >= config.max_retries:
                AiUsageLog.objects.create(paper=paper, user_email=user_email, task_type=task_type, provider=config.provider, model=model, duration_ms=int((time.monotonic() - started) * 1000), success=False, error_message=last_error[:4000])
                raise ValueError(f'AI không thể hoàn tất yêu cầu: {last_error}') from exc
    raise ValueError(last_error)


def generate_questions_with_ai(paper: ExamPaper, user_email: str) -> list[dict]:
    distribution = validate_distribution(paper.total_questions, paper.difficulty_distribution)
    demand = ', '.join(f'{DIFFICULTY_LABELS[key]}: {value}' for key, value in distribution.items())
    prompt = f'''Tạo chính xác {paper.total_questions} câu trắc nghiệm một đáp án đúng cho đề "{paper.title}".\nCuộc thi: {paper.competition.name if paper.competition else ''}\nKỳ thi: {paper.session.name if paper.session else ''}\nMôn: {paper.subject}; Khối/Bảng: {paper.grade_or_category}; Ngôn ngữ: {paper.language}; Thời gian: {paper.duration_minutes} phút.\nPhân bố: {demand}.\nChỉ trả JSON theo dạng {{"questions":[{{"content":"","choices":["A","B","C","D"],"correctAnswer":"A","explanation":"","difficulty":"EASY|MEDIUM|HARD|VERY_HARD","topic":""}}]}}. Không sao chép nguyên văn nguồn.\n\nNguồn tham chiếu:\n{source_context(paper)}'''
    result = call_ai_json(paper=paper, task_type='generate', model=_config().generation_model, user_email=user_email, system='Bạn là chuyên gia ra đề. Chỉ trả JSON hợp lệ, không markdown, không văn bản tự do.', prompt=prompt)
    rows = result.get('questions') if isinstance(result, dict) else None
    if not isinstance(rows, list) or len(rows) != paper.total_questions:
        raise ValueError('AI trả về số lượng câu hỏi không đúng yêu cầu.')
    normalized = [normalize_question(item, index + 1) for index, item in enumerate(rows)]
    actual = {key: sum(1 for item in normalized if item['difficulty'] == key) for key in DIFFICULTIES}
    if actual != distribution:
        raise ValueError('AI trả về phân bố độ khó không đúng yêu cầu.')
    return normalized


def review_questions_with_ai(paper: ExamPaper, auto_fix: bool, user_email: str) -> list[dict]:
    current = [serialize_question(item) for item in paper.questions.all()]
    prompt = f'''Kiểm tra đề trắc nghiệm dưới đây: đủ 4 phương án, một đáp án đúng, số lượng, độ khó, câu trùng, mơ hồ, vượt phạm vi, lỗi ngôn ngữ và phương án nhiễu. Nếu autoFix=true, chỉ viết lại các câu lỗi.\nTrả JSON {{"questions":[{{"id":"","status":"PASSED|AI_FIXED|NEEDS_REVIEW|WARNING","warnings":[""],"replacement":null hoặc question schema}}]}}.\nautoFix={str(auto_fix).lower()}\nĐề: {json.dumps(current, ensure_ascii=False)}\nNguồn: {source_context(paper)}'''
    result = call_ai_json(paper=paper, task_type='review_auto_fix' if auto_fix else 'review', model=_config().review_model, user_email=user_email, system='Bạn là kiểm định viên đề thi. Chỉ trả JSON hợp lệ.', prompt=prompt)
    return result.get('questions') if isinstance(result, dict) and isinstance(result.get('questions'), list) else []


def document_export(paper: ExamPaper, mode: str) -> bytes:
    document = Document()
    document.add_heading(paper.title, 0)
    document.add_paragraph(f'Môn: {paper.subject or "—"} | Khối/Bảng: {paper.grade_or_category or "—"} | Thời gian: {paper.duration_minutes} phút')
    include_answers = mode in {'answers', 'combined'}
    answers_only = mode == 'answers'
    if answers_only:
        document.add_heading('Đáp án', level=1)
    for question in paper.questions.all():
        if not answers_only:
            document.add_paragraph(f'Câu {question.order}. {question.content}')
            for index, choice in enumerate(question.choices or []):
                document.add_paragraph(f'{chr(65 + index)}. {choice}', style='List Bullet')
        if include_answers:
            document.add_paragraph(f'Đáp án câu {question.order}: {question.correct_answer}. {question.explanation}'.strip())
    output = BytesIO(); document.save(output); return output.getvalue()


def xlsx_export(paper: ExamPaper) -> bytes:
    workbook = Workbook(); sheet = workbook.active; sheet.title = 'Đề thi'
    sheet.append(['STT', 'Nội dung câu hỏi', 'Phương án A', 'Phương án B', 'Phương án C', 'Phương án D', 'Đáp án', 'Lời giải', 'Mức độ khó', 'Chủ đề', 'Cuộc thi', 'Trạng thái', 'Cảnh báo'])
    for question in paper.questions.all():
        choices = list(question.choices or []) + ['', '', '', '']
        sheet.append([question.order, question.content, choices[0], choices[1], choices[2], choices[3], question.correct_answer, question.explanation, DIFFICULTY_LABELS.get(question.difficulty, question.difficulty), question.topic, paper.competition.name if paper.competition else '', question.check_status, '; '.join(question.warnings or [])])
    output = BytesIO(); workbook.save(output); return output.getvalue()

def revise_question_with_ai(paper: ExamPaper, question: ExamQuestion, action: str, user_email: str) -> dict:
    instructions = {
        'rewrite': 'Viết lại câu hỏi để rõ ràng hơn nhưng giữ mục tiêu kiến thức và độ khó.',
        'distractors': 'Giữ nội dung và đáp án đúng, thay ba phương án nhiễu hợp lý, có sức phân loại.',
        'increase-difficulty': 'Tăng độ khó đúng một bậc nếu có thể, không vượt phạm vi đề.',
        'decrease-difficulty': 'Giảm độ khó đúng một bậc nhưng vẫn kiểm tra cùng kiến thức.',
        'replace': 'Thay bằng một câu hoàn toàn khác, cùng chủ đề và độ khó.',
    }
    if action not in instructions:
        raise ValueError('Thao tác AI cho câu hỏi không hợp lệ.')
    prompt = f'''{instructions[action]}\nChỉ trả JSON {{"question":{{"content":"","choices":["","","",""],"correctAnswer":"A","explanation":"","difficulty":"EASY|MEDIUM|HARD|VERY_HARD","topic":""}}}}.\nCâu hiện tại: {json.dumps(serialize_question(question), ensure_ascii=False)}\nNguồn: {source_context(paper)}'''
    result = call_ai_json(paper=paper, task_type=f'question_{action}', model=_config().generation_model, user_email=user_email, system='Bạn là chuyên gia ra đề. Chỉ trả JSON hợp lệ, không markdown.', prompt=prompt)
    row = result.get('question') if isinstance(result, dict) else None
    if not isinstance(row, dict):
        raise ValueError('AI không trả về câu hỏi hợp lệ.')
    return normalize_question({**row, 'order': question.order}, question.order)
# Blueprint-aware generation overrides. Every AI call receives one immutable slot;
# the returned question is normalised back against that slot rather than AI choices.
def normalize_question_for_slot(value: dict, order: int, slot: BlueprintSlot) -> dict:
    raw = dict(value or {})
    question_type = slot.question_type
    choices = raw.get('choices') or raw.get('options') or []
    if isinstance(choices, dict):
        choices = [choices.get(chr(65 + index), '') for index in range(slot.option_count)]
    if isinstance(choices, list):
        choices = [str(item.get('text', '')) if isinstance(item, dict) else str(item) for item in choices]
    answer = str(raw.get('correctAnswer') or raw.get('correct_answer') or '').strip().upper()
    if question_type == 'single_choice':
        if len(choices) != slot.option_count or any(not choice.strip() for choice in choices):
            raise ValueError(f'Slot {slot.position} cần đúng {slot.option_count} phương án.')
        valid = [chr(65 + index) for index in range(slot.option_count)]
        if answer not in valid:
            raise ValueError(f'Slot {slot.position} có đáp án không hợp lệ.')
    else:
        choices = []
        if not answer:
            raise ValueError(f'Slot {slot.position} cần đáp số đúng.')
    content = str(raw.get('content') or raw.get('question') or '').strip()
    if len(content) < 3:
        raise ValueError(f'Slot {slot.position} chưa có nội dung hợp lệ.')
    return {'content': content, 'choices': choices, 'correctAnswer': answer,
            'explanation': str(raw.get('explanation') or '').strip(), 'difficulty': slot.difficulty,
            'topic': slot.topic, 'order': order, 'blueprintSlotId': str(slot.id),
            'questionType': question_type, 'score': float(slot.score), 'slotMetadata': slot.metadata or {}}


def generate_questions_with_ai(paper: ExamPaper, user_email: str) -> list[dict]:
    version = paper.blueprint_version
    if not version or version.status != 'LOCKED':
        raise ValueError('Mỗi đề phải dùng một phiên bản ma trận đã khóa trước khi sinh AI.')
    slots = list(version.slots.all().order_by('position'))
    if not slots:
        raise ValueError('Phiên bản ma trận chưa có slot.')
    if paper.total_questions != len(slots):
        raise ValueError('Số câu của đề không khớp số slot trong phiên bản ma trận.')
    rows = []
    for slot in slots:
        prompt = f'''Sinh DUY NHẤT câu hỏi cho slot cố định sau, không đổi loại câu, số phương án, điểm, độ khó, chủ đề hay metadata bắt buộc.
Đề: {paper.title}; Cuộc thi: {paper.competition.name if paper.competition else ''}; Môn: {paper.subject}; Khối/Bảng: {paper.grade_or_category}; Ngôn ngữ: {paper.language}.
Slot: {json.dumps({'position': slot.position, 'questionType': slot.question_type, 'optionCount': slot.option_count, 'score': float(slot.score), 'difficulty': slot.difficulty, 'topic': slot.topic, 'knowledgeSource': slot.knowledge_source, 'knowledgeRequirements': slot.knowledge_requirements, 'prohibitedKnowledge': slot.prohibited_knowledge, 'assessmentIntent': slot.assessment_intent, 'estimatedSeconds': slot.estimated_seconds, 'metadata': slot.metadata}, ensure_ascii=False)}
Trả JSON đúng dạng {{"question":{{"content":"","choices":[],"correctAnswer":"","explanation":""}}}}. Với numeric_input: choices phải là mảng rỗng và correctAnswer là đáp số. Không sao chép nguyên văn nguồn.
Nguồn tham chiếu:
{source_context(paper)}'''
        result = call_ai_json(paper=paper, task_type='generate_slot', model=_config().generation_model, user_email=user_email, system='Bạn là chuyên gia ra đề. Chỉ trả JSON hợp lệ; tuân thủ tuyệt đối slot ma trận.', prompt=prompt)
        row = result.get('question') if isinstance(result, dict) else None
        if not isinstance(row, dict):
            raise ValueError(f'AI không trả về câu hợp lệ cho slot {slot.position}.')
        rows.append(normalize_question_for_slot(row, slot.position, slot))
    return rows


def revise_question_with_ai(paper: ExamPaper, question: ExamQuestion, action: str, user_email: str) -> dict:
    slot = question.blueprint_slot
    if not slot:
        raise ValueError('Câu hỏi cũ chưa gắn slot ma trận; hãy tạo đề mới từ ma trận.')
    instructions = {
        'rewrite': 'Viết lại cho rõ ràng hơn nhưng giữ nguyên mọi ràng buộc của slot.',
        'distractors': 'Giữ nội dung và đáp án đúng, tạo phương án nhiễu hợp lý theo slot.',
        'increase-difficulty': 'Không được thay đổi độ khó vì độ khó đã khóa trong slot; cải thiện chất lượng diễn đạt.',
        'decrease-difficulty': 'Không được thay đổi độ khó vì độ khó đã khóa trong slot; cải thiện chất lượng diễn đạt.',
        'replace': 'Thay bằng câu khác nhưng giữ nguyên toàn bộ ràng buộc slot.',
    }
    if action not in instructions:
        raise ValueError('Thao tác AI cho câu hỏi không hợp lệ.')
    prompt = f'''{instructions[action]}
Slot bắt buộc: {json.dumps({'questionType': slot.question_type, 'optionCount': slot.option_count, 'score': float(slot.score), 'difficulty': slot.difficulty, 'topic': slot.topic, 'metadata': slot.metadata}, ensure_ascii=False)}
Trả JSON {{"question":{{"content":"","choices":[],"correctAnswer":"","explanation":""}}}}.
Câu hiện tại: {json.dumps(serialize_question(question), ensure_ascii=False)}
Nguồn: {source_context(paper)}'''
    result = call_ai_json(paper=paper, task_type=f'question_{action}', model=_config().generation_model, user_email=user_email, system='Chỉ trả JSON hợp lệ và tuyệt đối không đổi ràng buộc của slot.', prompt=prompt)
    row = result.get('question') if isinstance(result, dict) else None
    if not isinstance(row, dict):
        raise ValueError('AI không trả về câu hỏi hợp lệ.')
    return normalize_question_for_slot(row, question.order, slot)