from __future__ import annotations

from django.db import transaction
from django.http import HttpResponse
from django.utils.text import slugify
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsAdmin, IsAuthenticated, IsManagerOrAdmin
from .models import AiProviderConfig, Competition, ExamPaper, ExamQuestion, ExamSession, ExamSourceDocument
from .paper_services import (
    default_distribution, document_export, encrypt_secret, generate_questions_with_ai,
    normalize_question, read_uploaded_source, review_questions_with_ai, revise_question_with_ai, serialize_ai_config,
    serialize_paper, serialize_question, validate_distribution, xlsx_export,
)


class IsWorkspaceUser(permissions.BasePermission):
    """Paper content is never public, unlike a few legacy read-only endpoints."""
    def has_permission(self, request, view):
        return bool(getattr(request, 'user', None) and getattr(request.user, 'email', ''))

def actor(request):
    return str(getattr(request.user, 'email', '') or getattr(request.user, 'username', '') or 'FT Workspace').strip()


def get_paper(pk):
    try:
        return ExamPaper.objects.select_related('competition', 'session').prefetch_related('questions', 'sources__referenced_paper').get(pk=pk)
    except ExamPaper.DoesNotExist:
        return None


def paper_payload(data, current=None):
    source = data or {}
    total = int(source.get('totalQuestions', getattr(current, 'total_questions', 0)) or 0)
    if total < 1 or total > 200:
        raise ValueError('Tổng số câu phải từ 1 đến 200.')
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
    distribution = validate_distribution(total, source.get('difficultyDistribution', getattr(current, 'difficulty_distribution', None) or default_distribution(total)))
    return {
        'title': str(source.get('title', getattr(current, 'title', '') or '')).strip(),
        'competition': competition, 'session': session,
        'subject': str(source.get('subject', getattr(current, 'subject', '') or '')).strip(),
        'grade_or_category': str(source.get('gradeOrCategory', getattr(current, 'grade_or_category', '') or '')).strip(),
        'language': str(source.get('language', getattr(current, 'language', 'Tiếng Việt') or 'Tiếng Việt')).strip(),
        'duration_minutes': int(source.get('durationMinutes', getattr(current, 'duration_minutes', 60)) or 60),
        'total_questions': total, 'difficulty_distribution': distribution,
        'description': str(source.get('description', getattr(current, 'description', '') or '')).strip(),
        'status': str(source.get('status', getattr(current, 'status', 'DRAFT') or 'DRAFT')).strip().upper(),
    }


@api_view(['GET', 'POST'])
@permission_classes([IsWorkspaceUser])
def papers_list(request):
    if request.method == 'GET':
        rows = ExamPaper.objects.select_related('competition', 'session').prefetch_related('questions').all()
        query = str(request.query_params.get('query', '')).strip()
        if query:
            rows = rows.filter(title__icontains=query)
        return Response({'items': [serialize_paper(item) for item in rows[:500]]})
    if getattr(request, 'user_role', '') not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Bạn không có quyền tạo đề thi.'}, status=status.HTTP_403_FORBIDDEN)
    try:
        payload = paper_payload(request.data)
        if not payload['title']:
            return Response({'error': 'Tên đề thi là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        item = ExamPaper.objects.create(**payload, created_by=actor(request), updated_by=actor(request))
        return Response(serialize_paper(item, include_questions=True), status=status.HTTP_201_CREATED)
    except (TypeError, ValueError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsWorkspaceUser])
def paper_detail(request, pk):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(serialize_paper(paper, include_questions=True))
    if getattr(request, 'user_role', '') not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Bạn không có quyền chỉnh sửa đề thi.'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'DELETE':
        paper.delete()
        return Response({'success': True})
    try:
        payload = paper_payload(request.data, paper)
        if not payload['title']:
            raise ValueError('Tên đề thi là bắt buộc.')
        for key, value in payload.items():
            setattr(paper, key, value)
        paper.updated_by = actor(request)
        paper.save()
        return Response(serialize_paper(get_paper(pk), include_questions=True))
    except (TypeError, ValueError) as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_duplicate(request, pk):
    source = get_paper(pk)
    if not source:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    with transaction.atomic():
        copy = ExamPaper.objects.create(title=f'{source.title} — Bản sao', competition=source.competition, session=source.session, subject=source.subject, grade_or_category=source.grade_or_category, language=source.language, duration_minutes=source.duration_minutes, total_questions=source.total_questions, difficulty_distribution=source.difficulty_distribution, status='DRAFT', description=source.description, created_by=actor(request), updated_by=actor(request))
        for item in source.questions.all():
            ExamQuestion.objects.create(paper=copy, order=item.order, content=item.content, choices=item.choices, correct_answer=item.correct_answer, explanation=item.explanation, difficulty=item.difficulty, topic=item.topic, check_status='PENDING')
    return Response(serialize_paper(get_paper(copy.pk), include_questions=True), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_source_upload(request, pk):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    uploaded = request.FILES.get('file')
    if not uploaded:
        return Response({'error': 'Chọn tệp PDF, DOCX hoặc XLSX.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        extracted = read_uploaded_source(uploaded)
        source = ExamSourceDocument.objects.create(paper=paper, source_type=str(request.data.get('sourceType') or 'UPLOAD').upper(), name=uploaded.name, file=uploaded, extracted_text=extracted, created_by=actor(request))
        return Response({'source': {'id': str(source.id), 'type': source.source_type, 'name': source.name, 'fileUrl': source.file.url if source.file else ''}}, status=status.HTTP_201_CREATED)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_source_reference(request, pk):
    paper = get_paper(pk)
    referenced = get_paper(request.data.get('paperId'))
    if not paper or not referenced:
        return Response({'error': 'Không tìm thấy đề nguồn.'}, status=status.HTTP_404_NOT_FOUND)
    source = ExamSourceDocument.objects.create(paper=paper, source_type='PAPER', name=referenced.title, referenced_paper=referenced, created_by=actor(request))
    return Response({'source': {'id': str(source.id), 'type': source.source_type, 'name': source.name, 'referencedPaperId': str(referenced.id)}}, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsManagerOrAdmin])
def paper_source_delete(request, pk, source_id):
    source = ExamSourceDocument.objects.filter(pk=source_id, paper_id=pk).first()
    if not source:
        return Response({'error': 'Không tìm thấy nguồn tài liệu.'}, status=status.HTTP_404_NOT_FOUND)
    source.delete(); return Response({'success': True})


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_questions_replace(request, pk):
    paper = get_paper(pk)
    rows = request.data.get('questions') if isinstance(request.data, dict) else None
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    if not isinstance(rows, list) or not rows:
        return Response({'error': 'Đề thi phải có ít nhất một câu hỏi.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        normalized = [normalize_question(row, index + 1) for index, row in enumerate(rows)]
        if len(normalized) != paper.total_questions:
            raise ValueError('Số câu hỏi phải đúng bằng tổng số câu đã khai báo.')
        with transaction.atomic():
            paper.questions.all().delete()
            for row in normalized:
                ExamQuestion.objects.create(paper=paper, order=row['order'], content=row['content'], choices=row['choices'], correct_answer=row['correctAnswer'], explanation=row['explanation'], difficulty=row['difficulty'], topic=row['topic'])
            paper.status = 'DRAFT'; paper.updated_by = actor(request); paper.save(update_fields=['status', 'updated_by', 'updated_at'])
        return Response(serialize_paper(get_paper(pk), include_questions=True))
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def paper_question_detail(request, pk, question_id):
    question = ExamQuestion.objects.filter(pk=question_id, paper_id=pk).first()
    if not question:
        return Response({'error': 'Không tìm thấy câu hỏi.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'DELETE':
        question.delete(); return Response({'success': True})
    try:
        row = normalize_question({**request.data, 'order': request.data.get('order', question.order)}, question.order)
        for key, value in {'order': row['order'], 'content': row['content'], 'choices': row['choices'], 'correct_answer': row['correctAnswer'], 'explanation': row['explanation'], 'difficulty': row['difficulty'], 'topic': row['topic']}.items(): setattr(question, key, value)
        question.check_status = 'PENDING'; question.warnings = []; question.save()
        return Response({'question': serialize_question(question)})
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_question_ai_action(request, pk, question_id, action):
    paper = get_paper(pk)
    question = ExamQuestion.objects.filter(pk=question_id, paper_id=pk).first()
    if not paper or not question:
        return Response({'error': 'Không tìm thấy câu hỏi.'}, status=status.HTTP_404_NOT_FOUND)
    try:
        row = revise_question_with_ai(paper, question, action, actor(request))
        question.content = row['content']; question.choices = row['choices']; question.correct_answer = row['correctAnswer']
        question.explanation = row['explanation']; question.difficulty = row['difficulty']; question.topic = row['topic']
        question.check_status = 'AI_FIXED'; question.warnings = []; question.save()
        return Response({'question': serialize_question(question)})
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_generate(request, pk):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    if paper.ai_generation_status in {'reading', 'generating', 'reviewing', 'saving'}:
        return Response({'error': 'Đề đang được AI xử lý.'}, status=status.HTTP_409_CONFLICT)
    try:
        paper.ai_generation_status = 'generating'; paper.ai_generation_message = 'Đang tạo câu hỏi bằng AI...'; paper.save(update_fields=['ai_generation_status', 'ai_generation_message', 'updated_at'])
        rows = generate_questions_with_ai(paper, actor(request))
        with transaction.atomic():
            paper.questions.all().delete()
            for row in rows:
                ExamQuestion.objects.create(paper=paper, order=row['order'], content=row['content'], choices=row['choices'], correct_answer=row['correctAnswer'], explanation=row['explanation'], difficulty=row['difficulty'], topic=row['topic'])
            paper.status = 'REVIEW'; paper.ai_generation_status = 'done'; paper.ai_generation_message = 'Đã tạo đề. Sẵn sàng kiểm tra AI.'; paper.updated_by = actor(request); paper.save()
        return Response(serialize_paper(get_paper(pk), include_questions=True))
    except ValueError as exc:
        paper.ai_generation_status = 'error'; paper.ai_generation_message = str(exc)[:500]; paper.save(update_fields=['ai_generation_status', 'ai_generation_message', 'updated_at'])
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_review(request, pk):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    auto_fix = bool(request.data.get('autoFix', False))
    if not paper.questions.exists():
        return Response({'error': 'Đề chưa có câu hỏi để kiểm tra.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        paper.ai_generation_status = 'reviewing'; paper.ai_generation_message = 'AI đang kiểm tra đề...'; paper.save(update_fields=['ai_generation_status', 'ai_generation_message', 'updated_at'])
        reviews = {str(row.get('id')): row for row in review_questions_with_ai(paper, auto_fix, actor(request)) if isinstance(row, dict)}
        for question in paper.questions.all():
            review = reviews.get(str(question.id), {})
            state = str(review.get('status') or 'PASSED').upper()
            if state not in {'PASSED', 'AI_FIXED', 'NEEDS_REVIEW', 'WARNING'}: state = 'WARNING'
            replacement = review.get('replacement')
            if auto_fix and isinstance(replacement, dict):
                updated = normalize_question({**replacement, 'order': question.order}, question.order)
                question.content, question.choices, question.correct_answer, question.explanation, question.difficulty, question.topic = updated['content'], updated['choices'], updated['correctAnswer'], updated['explanation'], updated['difficulty'], updated['topic']
                state = 'AI_FIXED'
            question.check_status = state; question.warnings = list(review.get('warnings') or []); question.save()
        paper.status = 'READY' if not paper.questions.exclude(check_status__in=['PASSED', 'AI_FIXED']).exists() else 'REVIEW'
        paper.ai_generation_status = 'done'; paper.ai_generation_message = 'Đã kiểm tra đề.'; paper.updated_by = actor(request); paper.save()
        return Response(serialize_paper(get_paper(pk), include_questions=True))
    except ValueError as exc:
        paper.ai_generation_status = 'error'; paper.ai_generation_message = str(exc)[:500]; paper.save(update_fields=['ai_generation_status', 'ai_generation_message', 'updated_at'])
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsManagerOrAdmin])
def paper_export(request, pk, export_type):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    name = slugify(paper.title) or 'de-thi'
    if export_type == 'xlsx':
        response = HttpResponse(xlsx_export(paper), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition'] = f'attachment; filename="{name}.xlsx"'; return response
    mode = str(request.query_params.get('mode', 'paper')).lower()
    if mode not in {'paper', 'answers', 'combined'}: mode = 'paper'
    response = HttpResponse(document_export(paper, mode), content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    response['Content-Disposition'] = f'attachment; filename="{name}-{mode}.docx"'; return response


@api_view(['GET', 'PUT'])
@permission_classes([IsAdmin])
def ai_config(request):
    config, _ = AiProviderConfig.objects.get_or_create(provider='openai')
    if request.method == 'GET':
        return Response(serialize_ai_config(config))
    data = request.data or {}
    if str(data.get('provider') or 'openai').lower() != 'openai':
        return Response({'error': 'MVP hiện chỉ hỗ trợ OpenAI-compatible API.'}, status=status.HTTP_400_BAD_REQUEST)
    config.base_url = str(data.get('baseUrl') or config.base_url).strip().rstrip('/')
    config.generation_model = str(data.get('generationModel') or config.generation_model).strip()
    config.review_model = str(data.get('reviewModel') or config.review_model).strip()
    config.temperature = max(0, min(2, float(data.get('temperature', config.temperature))))
    config.max_tokens = max(256, min(64000, int(data.get('maxTokens', config.max_tokens))))
    config.timeout_seconds = max(10, min(600, int(data.get('timeoutSeconds', config.timeout_seconds))))
    config.max_retries = max(0, min(5, int(data.get('maxRetries', config.max_retries))))
    api_key = str(data.get('apiKey') or '').strip()
    if api_key: config.api_key_encrypted = encrypt_secret(api_key)
    config.updated_by = actor(request); config.save()
    return Response(serialize_ai_config(config))


@api_view(['POST'])
@permission_classes([IsAdmin])
def ai_config_test(request):
    from .paper_services import decrypt_secret
    config, _ = AiProviderConfig.objects.get_or_create(provider='openai')
    try:
        api_key = decrypt_secret(config.api_key_encrypted)
        if not api_key: raise ValueError('Chưa có API key.')
        response = __import__('requests').get(config.base_url.rstrip('/') + '/models', headers={'Authorization': f'Bearer {api_key}'}, timeout=min(config.timeout_seconds, 30))
        response.raise_for_status()
        return Response({'success': True, 'message': 'Kết nối AI thành công.'})
    except Exception as exc:
        return Response({'success': False, 'error': f'Không thể kết nối AI: {exc}'}, status=status.HTTP_400_BAD_REQUEST)