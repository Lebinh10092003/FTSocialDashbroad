from __future__ import annotations

from io import BytesIO

from django.db import transaction
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsManagerOrAdmin
from .models import Blueprint, BlueprintVersion, Competition, ExamSession
from .paper_views import IsWorkspaceUser, actor
from .blueprint_services import (difficulty_distribution, draft_slots, lock_version, replace_slots,
    serialize_blueprint, serialize_version, validate_metadata_schema)


def blueprint_payload(data, current=None):
    source = data or {}
    competition_id = str(source.get('competitionId', getattr(current, 'competition_id', '') or '')).strip()
    session_id = str(source.get('sessionId', getattr(current, 'session_id', '') or '')).strip()
    competition = Competition.objects.filter(pk=competition_id).first() if competition_id else None
    session = ExamSession.objects.filter(pk=session_id).first() if session_id else None
    if competition_id and not competition:
        raise ValueError('Không tìm thấy cuộc thi đã chọn.')
    if session_id and not session:
        raise ValueError('Không tìm thấy kỳ thi đã chọn.')
    if session and not competition:
        competition = Competition.objects.filter(pk=session.competition_id).first()
    return {
        'name': str(source.get('name', getattr(current, 'name', '') or '')).strip(), 'competition': competition, 'session': session,
        'round_name': str(source.get('roundName', getattr(current, 'round_name', '') or '')).strip(),
        'subject': str(source.get('subject', getattr(current, 'subject', '') or '')).strip(),
        'grade_or_category': str(source.get('gradeOrCategory', getattr(current, 'grade_or_category', '') or '')).strip(),
        'language': str(source.get('language', getattr(current, 'language', 'Tiếng Việt') or 'Tiếng Việt')).strip(),
        'metadata_schema': validate_metadata_schema(source.get('metadataSchema', getattr(current, 'metadata_schema', {}) or {})),
        'description': str(source.get('description', getattr(current, 'description', '') or '')).strip(),
    }


@api_view(['GET', 'POST'])
@permission_classes([IsWorkspaceUser])
def blueprints_list(request):
    if request.method == 'GET':
        rows = Blueprint.objects.select_related('competition', 'session').prefetch_related('versions__slots').all()
        competition_id = str(request.query_params.get('competitionId') or '').strip()
        if competition_id:
            rows = rows.filter(competition_id=competition_id)
        return Response({'items': [serialize_blueprint(item, include_versions=True) for item in rows[:500]]})
    if getattr(request, 'user_role', '') not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Bạn không có quyền tạo ma trận đề.'}, status=status.HTTP_403_FORBIDDEN)
    try:
        payload = blueprint_payload(request.data)
        if not payload['name']:
            raise ValueError('Tên ma trận đề là bắt buộc.')
        with transaction.atomic():
            item = Blueprint.objects.create(**payload, created_by=actor(request), updated_by=actor(request))
            version = BlueprintVersion.objects.create(blueprint=item, version_number=1, note=str(request.data.get('versionNote') or ''), created_by=actor(request))
            if request.data.get('slots'):
                replace_slots(version, request.data.get('slots') or [])
        return Response(serialize_blueprint(Blueprint.objects.prefetch_related('versions__slots').get(pk=item.pk), include_versions=True), status=status.HTTP_201_CREATED)
    except (TypeError, ValueError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsWorkspaceUser])
def blueprint_detail(request, pk):
    item = Blueprint.objects.select_related('competition', 'session').prefetch_related('versions__slots').filter(pk=pk).first()
    if not item:
        return Response({'error': 'Không tìm thấy ma trận đề.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(serialize_blueprint(item, include_versions=True))
    if getattr(request, 'user_role', '') not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Bạn không có quyền chỉnh sửa ma trận đề.'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'DELETE':
        if item.versions.filter(exam_papers__isnull=False).exists():
            return Response({'error': 'Không thể xóa ma trận đã được dùng để sinh đề.'}, status=status.HTTP_400_BAD_REQUEST)
        item.delete(); return Response({'success': True})
    try:
        payload = blueprint_payload(request.data, item)
        if not payload['name']:
            raise ValueError('Tên ma trận đề là bắt buộc.')
        for key, value in payload.items(): setattr(item, key, value)
        item.updated_by = actor(request); item.save()
        return Response(serialize_blueprint(Blueprint.objects.prefetch_related('versions__slots').get(pk=item.pk), include_versions=True))
    except (TypeError, ValueError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def blueprint_draft_from_config(request):
    try:
        total = int(request.data.get('totalQuestions') or 0)
        distribution = difficulty_distribution(total, request.data.get('difficultyDistribution'))
        topics = request.data.get('topics') if isinstance(request.data.get('topics'), list) else []
        slots = draft_slots(total, distribution, topics, str(request.data.get('questionType') or 'single_choice'), int(request.data.get('optionCount') or 4), str(request.data.get('description') or ''))
        payload = blueprint_payload({**request.data, 'name': request.data.get('name') or f'Ma trận nháp {request.data.get("subject") or ""}'.strip()})
        if not payload['name']:
            payload['name'] = 'Ma trận nháp'
        with transaction.atomic():
            item = Blueprint.objects.create(**payload, created_by=actor(request), updated_by=actor(request))
            version = BlueprintVersion.objects.create(blueprint=item, version_number=1, note='Tạo tự động từ wizard tạo đề', created_by=actor(request))
            replace_slots(version, slots)
        return Response({'blueprint': serialize_blueprint(Blueprint.objects.prefetch_related('versions__slots').get(pk=item.pk), include_versions=True), 'version': serialize_version(BlueprintVersion.objects.prefetch_related('slots').get(pk=version.pk), include_slots=True)}, status=status.HTTP_201_CREATED)
    except (TypeError, ValueError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def blueprint_duplicate(request, pk):
    source = Blueprint.objects.prefetch_related('versions__slots').filter(pk=pk).first()
    if not source:
        return Response({'error': 'Không tìm thấy ma trận đề.'}, status=status.HTTP_404_NOT_FOUND)
    with transaction.atomic():
        copy = Blueprint.objects.create(name=f'{source.name} — Bản sao', competition=source.competition, session=source.session, round_name=source.round_name, subject=source.subject, grade_or_category=source.grade_or_category, language=source.language, metadata_schema=source.metadata_schema, description=source.description, created_by=actor(request), updated_by=actor(request))
        latest = source.versions.order_by('-version_number').first()
        version = BlueprintVersion.objects.create(blueprint=copy, version_number=1, note=f'Nhân bản từ {source.name}', created_by=actor(request))
        if latest:
            replace_slots(version, [{'position': slot.position, 'questionType': slot.question_type, 'optionCount': slot.option_count, 'score': str(slot.score), 'difficulty': slot.difficulty, 'topic': slot.topic, 'knowledgeSource': slot.knowledge_source, 'knowledgeRequirements': slot.knowledge_requirements, 'prohibitedKnowledge': slot.prohibited_knowledge, 'assessmentIntent': slot.assessment_intent, 'estimatedSeconds': slot.estimated_seconds, 'metadata': slot.metadata} for slot in latest.slots.all()])
    return Response(serialize_blueprint(Blueprint.objects.prefetch_related('versions__slots').get(pk=copy.pk), include_versions=True), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def blueprint_new_version(request, pk):
    item = Blueprint.objects.prefetch_related('versions__slots').filter(pk=pk).first()
    if not item:
        return Response({'error': 'Không tìm thấy ma trận đề.'}, status=status.HTTP_404_NOT_FOUND)
    with transaction.atomic():
        newest = item.versions.order_by('-version_number').first()
        version = BlueprintVersion.objects.create(blueprint=item, version_number=(newest.version_number if newest else 0) + 1, note=str(request.data.get('note') or ''), created_by=actor(request))
        if newest:
            replace_slots(version, [{'position': slot.position, 'questionType': slot.question_type, 'optionCount': slot.option_count, 'score': str(slot.score), 'difficulty': slot.difficulty, 'topic': slot.topic, 'knowledgeSource': slot.knowledge_source, 'knowledgeRequirements': slot.knowledge_requirements, 'prohibitedKnowledge': slot.prohibited_knowledge, 'assessmentIntent': slot.assessment_intent, 'estimatedSeconds': slot.estimated_seconds, 'metadata': slot.metadata} for slot in newest.slots.all()])
    return Response(serialize_version(BlueprintVersion.objects.prefetch_related('slots').get(pk=version.pk), include_slots=True), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT'])
@permission_classes([IsWorkspaceUser])
def blueprint_version_detail(request, pk):
    version = BlueprintVersion.objects.select_related('blueprint__competition', 'blueprint__session').prefetch_related('slots').filter(pk=pk).first()
    if not version:
        return Response({'error': 'Không tìm thấy phiên bản ma trận.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(serialize_version(version, include_slots=True))
    if getattr(request, 'user_role', '') not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Bạn không có quyền chỉnh sửa phiên bản ma trận.'}, status=status.HTTP_403_FORBIDDEN)
    try:
        replace_slots(version, request.data.get('slots') or [])
        version.note = str(request.data.get('note', version.note) or '')
        version.save(update_fields=['note', 'updated_at'])
        return Response(serialize_version(BlueprintVersion.objects.prefetch_related('slots').get(pk=version.pk), include_slots=True))
    except (TypeError, ValueError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def blueprint_version_lock(request, pk):
    version = BlueprintVersion.objects.prefetch_related('slots').filter(pk=pk).first()
    if not version:
        return Response({'error': 'Không tìm thấy phiên bản ma trận.'}, status=status.HTTP_404_NOT_FOUND)
    try:
        lock_version(version, actor(request))
        return Response(serialize_version(BlueprintVersion.objects.prefetch_related('slots').get(pk=version.pk), include_slots=True))
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def _header_map(sheet):
    values = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True), [])
    return {str(value or '').strip().lower(): index for index, value in enumerate(values) if str(value or '').strip()}


def _value(row, headers, *names):
    for name in names:
        index = headers.get(name.lower())
        if index is not None and index < len(row): return row[index]
    return ''


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def blueprint_version_import(request, pk):
    version = BlueprintVersion.objects.select_related('blueprint').filter(pk=pk).first()
    uploaded = request.FILES.get('file')
    if not version or not uploaded:
        return Response({'error': 'Cần chọn phiên bản nháp và file XLSX.'}, status=status.HTTP_400_BAD_REQUEST)
    if version.status != BlueprintVersion.STATUS_DRAFT:
        return Response({'error': 'Chỉ import vào phiên bản nháp.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        workbook = load_workbook(BytesIO(uploaded.read()), read_only=True, data_only=True)
        sheet = workbook.active; headers = _header_map(sheet); rows = []
        for number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), 1):
            if not any(value not in (None, '') for value in row): continue
            rows.append({'position': _value(row, headers, 'Vị trí', 'Position') or number, 'questionType': _value(row, headers, 'Loại câu', 'Question type') or 'single_choice', 'optionCount': _value(row, headers, 'Số phương án', 'Option count') or 4, 'score': _value(row, headers, 'Điểm', 'Score') or 1, 'difficulty': _value(row, headers, 'Mức độ', 'Difficulty') or 'MEDIUM', 'topic': _value(row, headers, 'Chủ đề', 'Topic'), 'knowledgeSource': _value(row, headers, 'Nguồn kiến thức', 'Knowledge source'), 'knowledgeRequirements': _value(row, headers, 'Yêu cầu kiến thức', 'Knowledge requirements'), 'prohibitedKnowledge': _value(row, headers, 'Không sử dụng', 'Prohibited knowledge'), 'assessmentIntent': _value(row, headers, 'Assessment intent', 'Mục tiêu đánh giá'), 'estimatedSeconds': _value(row, headers, 'Thời gian dự kiến', 'Estimated seconds') or 90, 'metadata': {}})
        replace_slots(version, rows)
        return Response(serialize_version(BlueprintVersion.objects.prefetch_related('slots').get(pk=version.pk), include_slots=True))
    except Exception as exc:
        return Response({'error': f'Không thể import ma trận: {exc}'}, status=status.HTTP_400_BAD_REQUEST)