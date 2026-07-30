from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from typing import Any

from jsonschema import Draft202012Validator

from .models import Blueprint, BlueprintSlot, BlueprintVersion

DIFFICULTIES = ('EASY', 'MEDIUM', 'HARD', 'VERY_HARD')
QUESTION_TYPES = {'single_choice', 'numeric_input'}


def analyze_blueprint_slots(slots, previous: dict | None = None) -> dict:
    rows = list(slots)
    difficulty, internal, question_types, options, topics, knowledge_sources = {}, {}, {}, {}, {}, {}
    missing = {'difficulty': [], 'topic': [], 'assessmentIntent': []}
    signature = []
    total_score, total_seconds = Decimal('0'), 0
    for slot in rows:
        metadata = slot.metadata or {}
        label = str(metadata.get('difficultyLabel') or slot.difficulty or 'Chưa phân loại').strip()
        difficulty[label] = difficulty.get(label, 0) + 1
        internal[slot.difficulty] = internal.get(slot.difficulty, 0) + 1
        question_types[slot.question_type] = question_types.get(slot.question_type, 0) + 1
        option_key = str(slot.option_count if slot.question_type == 'single_choice' else 0)
        options[option_key] = options.get(option_key, 0) + 1
        topic = slot.topic.strip() or 'Chưa phân loại'
        topics[topic] = topics.get(topic, 0) + 1
        source = slot.knowledge_source.strip() or 'Chưa xác định'
        knowledge_sources[source] = knowledge_sources.get(source, 0) + 1
        if label in {'', 'Chưa phân loại'}: missing['difficulty'].append(slot.position)
        if not slot.topic.strip(): missing['topic'].append(slot.position)
        if not slot.assessment_intent.strip(): missing['assessmentIntent'].append(slot.position)
        total_score += slot.score
        total_seconds += slot.estimated_seconds
        signature.append({'position': slot.position, 'type': slot.question_type, 'options': slot.option_count, 'score': str(slot.score), 'difficulty': label, 'topic': slot.topic, 'intent': slot.assessment_intent, 'metadata': metadata})
    warnings = []
    for field, positions in missing.items():
        if positions:
            warnings.append({'code': f'MISSING_{field.upper()}', 'message': f'{len(positions)} câu thiếu {field}.', 'positions': positions})
    base = dict(previous or {})
    return {
        **base,
        'parserVersion': 'matrix-profile-v2',
        'totalQuestions': len(rows), 'totalScore': float(total_score),
        'estimatedDurationMinutes': max(1, round(total_seconds / 60)) if rows else 0,
        'difficultyDistribution': difficulty, 'internalDifficultyDistribution': internal,
        'questionTypeDistribution': question_types, 'optionCountDistribution': options,
        'topicDistribution': topics, 'knowledgeSourceDistribution': knowledge_sources,
        'missingFields': missing, 'warnings': warnings,
        'structureHash': hashlib.sha256(json.dumps(signature, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest(),
    }


def difficulty_distribution(total: int, raw: dict | None = None) -> dict[str, int]:
    total = max(1, min(200, int(total or 1)))
    if raw is None:
        easy, hard, very_hard = total * 20 // 100, total * 20 // 100, total * 10 // 100
        return {'EASY': easy, 'MEDIUM': total - easy - hard - very_hard, 'HARD': hard, 'VERY_HARD': very_hard}
    values = {key: max(0, int((raw or {}).get(key, 0) or 0)) for key in DIFFICULTIES}
    if sum(values.values()) != total:
        raise ValueError('Tổng số slot theo bốn mức độ khó phải bằng tổng số câu.')
    return values


def validate_metadata_schema(schema: Any) -> dict:
    value = schema if isinstance(schema, dict) else {}
    if value:
        try:
            Draft202012Validator.check_schema(value)
        except Exception as exc:
            raise ValueError(f'Schema metadata không hợp lệ: {exc}') from exc
    return value


def normalized_slot(raw: dict, position: int, schema: dict | None = None) -> dict:
    value = dict(raw or {})
    question_type = str(value.get('questionType') or value.get('question_type') or 'single_choice').strip()
    if question_type not in QUESTION_TYPES:
        raise ValueError(f'Loại câu hỏi không hỗ trợ: {question_type}.')
    option_count = int(value.get('optionCount', value.get('option_count', 4)) or 0)
    if question_type == 'single_choice' and not 2 <= option_count <= 8:
        raise ValueError('Câu trắc nghiệm cần từ 2 đến 8 phương án.')
    if question_type == 'numeric_input':
        option_count = 0
    metadata = value.get('metadata') if isinstance(value.get('metadata'), dict) else {}
    difficulty_label = str(value.get('difficultyLabel') or metadata.get('difficultyLabel') or value.get('difficulty') or 'Chưa phân loại').strip()
    difficulty = str(value.get('difficulty') or 'MEDIUM').upper()
    if difficulty not in DIFFICULTIES:
        raise ValueError('Mức độ khó không hợp lệ.')
    try:
        score = Decimal(str(value.get('score', 1) or 1))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError('Điểm của slot không hợp lệ.') from exc
    if score <= 0:
        raise ValueError('Điểm của slot phải lớn hơn 0.')
    metadata = {**metadata, 'difficultyLabel': difficulty_label}
    if schema:
        errors = list(Draft202012Validator(schema).iter_errors(metadata))
        if errors:
            raise ValueError('Metadata slot không đúng schema: ' + '; '.join(error.message for error in errors[:2]))
    return {
        'position': int(value.get('position') or position), 'question_type': question_type, 'option_count': option_count,
        'score': score, 'difficulty': difficulty, 'topic': str(value.get('topic') or '').strip(),
        'knowledge_source': str(value.get('knowledgeSource', value.get('knowledge_source', '')) or '').strip(),
        'knowledge_requirements': str(value.get('knowledgeRequirements', value.get('knowledge_requirements', '')) or '').strip(),
        'prohibited_knowledge': str(value.get('prohibitedKnowledge', value.get('prohibited_knowledge', '')) or '').strip(),
        'assessment_intent': str(value.get('assessmentIntent', value.get('assessment_intent', '')) or '').strip(),
        'estimated_seconds': max(1, int(value.get('estimatedSeconds', value.get('estimated_seconds', 90)) or 90)),
        'metadata': metadata,
    }


def serialize_slot(slot: BlueprintSlot) -> dict:
    difficulty_label = str((slot.metadata or {}).get('difficultyLabel') or slot.difficulty)
    return {
        'id': str(slot.id), 'position': slot.position, 'questionType': slot.question_type, 'optionCount': slot.option_count,
        'score': float(slot.score), 'difficulty': slot.difficulty, 'topic': slot.topic, 'knowledgeSource': slot.knowledge_source,
        'knowledgeRequirements': slot.knowledge_requirements, 'prohibitedKnowledge': slot.prohibited_knowledge,
        'assessmentIntent': slot.assessment_intent, 'estimatedSeconds': slot.estimated_seconds, 'difficultyLabel': difficulty_label, 'metadata': slot.metadata or {},
    }


def serialize_version(version: BlueprintVersion, include_slots: bool = False) -> dict:
    slots = list(version.slots.all())
    analysis = version.analysis or {}
    data = {'id': str(version.id), 'blueprintId': str(version.blueprint_id), 'versionNumber': version.version_number,
            'status': version.status, 'note': version.note, 'slotCount': int(analysis.get('totalQuestions', len(slots))),
            'difficultyDistribution': analysis.get('difficultyDistribution', {}), 'analysis': analysis, 'createdBy': version.created_by,
            'lockedBy': version.locked_by, 'lockedAt': version.locked_at.isoformat() if version.locked_at else '',
            'createdAt': version.created_at.isoformat(), 'updatedAt': version.updated_at.isoformat()}
    if include_slots:
        data['slots'] = [serialize_slot(slot) for slot in slots]
    return data


def serialize_blueprint(blueprint: Blueprint, include_versions: bool = False) -> dict:
    data = {
        'id': str(blueprint.id), 'name': blueprint.name, 'competitionId': str(blueprint.competition_id or ''),
        'competitionName': blueprint.competition.name if blueprint.competition else '', 'sessionId': str(blueprint.session_id or ''),
        'sessionName': blueprint.session.name if blueprint.session else '', 'roundName': blueprint.round_name, 'subject': blueprint.subject,
        'gradeOrCategory': blueprint.grade_or_category, 'language': blueprint.language, 'durationMinutes': blueprint.duration_minutes,
        'metadataSchema': blueprint.metadata_schema or {},
        'description': blueprint.description, 'createdBy': blueprint.created_by, 'updatedBy': blueprint.updated_by,
        'createdAt': blueprint.created_at.isoformat(), 'updatedAt': blueprint.updated_at.isoformat(),
    }
    if include_versions:
        data['versions'] = [serialize_version(version, include_slots=True) for version in blueprint.versions.all()]
    return data


def replace_slots(version: BlueprintVersion, slots: list[dict]) -> list[BlueprintSlot]:
    if version.status != BlueprintVersion.STATUS_DRAFT:
        raise ValueError('Chỉ có thể chỉnh sửa phiên bản ma trận đang ở trạng thái nháp.')
    schema = version.blueprint.metadata_schema or {}
    rows = [normalized_slot(row, index + 1, schema) for index, row in enumerate(slots or [])]
    if not rows:
        raise ValueError('Ma trận cần có ít nhất một slot.')
    positions = [row['position'] for row in rows]
    if len(set(positions)) != len(positions) or sorted(positions) != list(range(1, len(rows) + 1)):
        raise ValueError('Vị trí slot phải liên tục từ 1 đến tổng số slot.')
    version.slots.all().delete()
    created = [BlueprintSlot.objects.create(version=version, **row) for row in rows]
    blueprint = version.blueprint
    version.analysis = analyze_blueprint_slots(created, {
        'source': (version.analysis or {}).get('source', {}),
        'matrixContext': {
            'competitionId': str(blueprint.competition_id or ''),
            'competitionName': blueprint.competition.name if blueprint.competition else '',
            'sessionId': str(blueprint.session_id or ''),
            'sessionName': blueprint.session.name if blueprint.session else '',
            'roundName': blueprint.round_name,
            'subject': blueprint.subject,
            'gradeOrCategory': blueprint.grade_or_category,
            'language': blueprint.language,
            'durationMinutes': blueprint.duration_minutes,
        },
        'generationRules': {
            'useExactSlotOrder': True,
            'preserveOriginalDifficultyLabels': True,
            'preserveQuestionTypesAndOptions': True,
            'avoidDuplicateQuestions': True,
            'balanceMultipleChoiceAnswers': True,
        },
    })
    version.save(update_fields=['analysis', 'updated_at'])
    return created


def lock_version(version: BlueprintVersion, actor: str) -> BlueprintVersion:
    if version.status != BlueprintVersion.STATUS_DRAFT:
        raise ValueError('Chỉ khóa được phiên bản ma trận đang là nháp.')
    slots = list(version.slots.all())
    if not slots:
        raise ValueError('Không thể khóa ma trận chưa có slot.')
    positions = [slot.position for slot in slots]
    if positions != list(range(1, len(slots) + 1)):
        raise ValueError('Vị trí slot phải liên tục trước khi khóa.')
    from django.utils import timezone
    version.status, version.locked_by, version.locked_at = BlueprintVersion.STATUS_LOCKED, actor, timezone.now()
    version.save(update_fields=['status', 'locked_by', 'locked_at', 'updated_at'])
    return version


def draft_slots(total: int, distribution: dict | None = None, topics: list[str] | None = None, question_type: str = 'single_choice', option_count: int = 4, description: str = '') -> list[dict]:
    levels = difficulty_distribution(total, distribution)
    topic_list = [str(topic).strip() for topic in (topics or []) if str(topic).strip()] or ['Chưa phân nhóm chủ đề']
    rows, position = [], 1
    for level in DIFFICULTIES:
        for _ in range(levels[level]):
            rows.append({'position': position, 'questionType': question_type, 'optionCount': option_count, 'score': 1,
                         'difficulty': level, 'topic': topic_list[(position - 1) % len(topic_list)],
                         'assessmentIntent': description, 'estimatedSeconds': 90, 'metadata': {}})
            position += 1
    return rows
