from __future__ import annotations

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsAdmin, IsAuthenticated, IsManagerOrAdmin
from .models import AiProviderConfig, BlueprintVersion, Competition, ExamGenerationJob, ExamPaper, ExamQuestion, ExamReview, ExamSession, ExamSourceDocument
from .paper_services import (
    default_distribution, document_export, encrypt_secret, generate_questions_with_ai,
    normalize_question, normalize_question_for_slot, paper_quality_report, read_uploaded_source, review_questions_with_ai, revise_paper_from_chat, revise_question_with_ai, serialize_ai_config,
    serialize_paper, serialize_question, validate_distribution, xlsx_export,
)


class IsWorkspaceUser(permissions.BasePermission):
    """Paper content is private and must honor the Examination module scope."""
    def has_permission(self, request, view):
        return IsAuthenticated().has_permission(request, view)

def actor(request):
    return str(getattr(request.user, 'email', '') or getattr(request.user, 'username', '') or 'FT Workspace').strip()


def get_paper(pk):
    try:
        return ExamPaper.objects.select_related('competition', 'session', 'blueprint_version__blueprint').prefetch_related('questions__blueprint_slot', 'sources__referenced_paper', 'human_reviews__question').get(pk=pk)
    except ExamPaper.DoesNotExist:
        return None


def reset_paper_workflow(paper, user_email):
    paper.status = ExamPaper.STATUS_DRAFT
    paper.quality_report = {}
    paper.draft_exported_at = None
    paper.approved_at = None
    paper.approved_by = ''
    paper.official_exported_at = None
    paper.banked_at = None
    paper.updated_by = user_email
    paper.human_reviews.all().delete()


def paper_payload(data, current=None):
    source = data or {}
    version_id = str(source.get('blueprintVersionId', getattr(current, 'blueprint_version_id', '') or '')).strip()
    version = BlueprintVersion.objects.select_related('blueprint__competition', 'blueprint__session').prefetch_related('slots').filter(pk=version_id).first() if version_id else None
    if not current and not version:
        raise ValueError('Chọn phiên bản ma trận đã khóa trước khi tạo đề.')
    if version and version.status != BlueprintVersion.STATUS_LOCKED:
        raise ValueError('Chỉ có thể tạo đề từ phiên bản ma trận đã khóa.')
    if current and current.blueprint_version_id and version and str(current.blueprint_version_id) != str(version.id):
        raise ValueError('Không thể đổi phiên bản ma trận của đề đã tạo.')
    if version:
        blueprint = version.blueprint
        profile = version.analysis or {}
        total = int(profile.get('totalQuestions') or 0)
        if not total:
            raise ValueError('Phiên bản ma trận chưa có hồ sơ phân tích. Hãy nhập lại file hoặc lưu lại các slot.')
        distribution = dict(profile.get('difficultyDistribution') or {})
        if sum(int(value or 0) for value in distribution.values()) != total:
            raise ValueError('Hồ sơ phân tích ma trận không khớp tổng số câu. Hãy nhập lại file ma trận.')
        competition, session = blueprint.competition, blueprint.session
        if not competition and session:
            competition = Competition.objects.filter(pk=session.competition_id).first()
        subject, grade, language = blueprint.subject, blueprint.grade_or_category, blueprint.language
    else:
        total = int(source.get('totalQuestions', getattr(current, 'total_questions', 0)) or 0)
        distribution = validate_distribution(total, source.get('difficultyDistribution', getattr(current, 'difficulty_distribution', None) or default_distribution(total)))
        competition, session = current.competition, current.session
        subject, grade, language = current.subject, current.grade_or_category, current.language
    if total < 1 or total > 200:
        raise ValueError('Tổng số câu phải từ 1 đến 200.')
    return {
        'title': str(source.get('title', getattr(current, 'title', '') or '')).strip(), 'blueprint_version': version or getattr(current, 'blueprint_version', None),
        'competition': competition, 'session': session, 'subject': subject, 'grade_or_category': grade, 'language': language,
        'duration_minutes': blueprint.duration_minutes if version else int(source.get('durationMinutes', getattr(current, 'duration_minutes', 60)) or 60),
        'total_questions': total, 'difficulty_distribution': distribution,
        'description': str(source.get('description', getattr(current, 'description', '') or '')).strip(),
        'status': str(source.get('status', getattr(current, 'status', 'DRAFT') or 'DRAFT')).strip().upper(),
    }

@api_view(['GET', 'POST'])
@permission_classes([IsWorkspaceUser])
def papers_list(request):
    if request.method == 'GET':
        rows = ExamPaper.objects.select_related('competition', 'session', 'blueprint_version__blueprint').prefetch_related('questions').all()
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
        reset_paper_workflow(paper, actor(request))
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
        copy = ExamPaper.objects.create(title=f'{source.title} — Bản sao', blueprint_version=source.blueprint_version, competition=source.competition, session=source.session, subject=source.subject, grade_or_category=source.grade_or_category, language=source.language, duration_minutes=source.duration_minutes, total_questions=source.total_questions, difficulty_distribution=source.difficulty_distribution, status='DRAFT', description=source.description, created_by=actor(request), updated_by=actor(request))
        for item in source.questions.all():
            ExamQuestion.objects.create(paper=copy, blueprint_slot=item.blueprint_slot, question_type=item.question_type, score=item.score, slot_metadata=item.slot_metadata, order=item.order, content=item.content, choices=item.choices, correct_answer=item.correct_answer, explanation=item.explanation, difficulty=item.difficulty, topic=item.topic, check_status='PENDING')
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
        if not paper.blueprint_version_id or paper.blueprint_version.status != 'LOCKED':
            raise ValueError('Chỉ có thể thay câu hỏi của đề đã gắn phiên bản ma trận khóa.')
        slots = list(paper.blueprint_version.slots.all().order_by('position'))
        if len(rows) != len(slots):
            raise ValueError('Số câu hỏi phải đúng bằng số slot của ma trận.')
        normalized = [normalize_question_for_slot(row, index + 1, slots[index]) for index, row in enumerate(rows)]
        with transaction.atomic():
            paper.questions.all().delete()
            for row in normalized:
                ExamQuestion.objects.create(paper=paper, blueprint_slot_id=row.get('blueprintSlotId'), question_type=row.get('questionType', 'single_choice'), score=row.get('score', 1), slot_metadata=row.get('slotMetadata', {}), order=row['order'], content=row['content'], choices=row['choices'], correct_answer=row['correctAnswer'], explanation=row['explanation'], difficulty=row['difficulty'], topic=row['topic'])
            reset_paper_workflow(paper, actor(request)); paper.save()
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
        row = normalize_question_for_slot({**request.data, 'order': question.order}, question.order, question.blueprint_slot) if question.blueprint_slot_id else normalize_question({**request.data, 'order': request.data.get('order', question.order)}, question.order)
        for key, value in {'order': row['order'], 'content': row['content'], 'choices': row['choices'], 'correct_answer': row['correctAnswer'], 'explanation': row['explanation'], 'difficulty': row['difficulty'], 'topic': row['topic'], 'question_type': row.get('questionType', question.question_type), 'score': row.get('score', question.score), 'slot_metadata': row.get('slotMetadata', question.slot_metadata)}.items(): setattr(question, key, value)
        question.check_status = 'PENDING'; question.warnings = []; question.save()
        reset_paper_workflow(question.paper, actor(request)); question.paper.save()
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
        question.explanation = row['explanation']; question.difficulty = row['difficulty']; question.topic = row['topic']; question.question_type = row.get('questionType', question.question_type); question.score = row.get('score', question.score); question.slot_metadata = row.get('slotMetadata', question.slot_metadata)
        question.check_status = 'AI_FIXED'; question.warnings = []; question.save()
        reset_paper_workflow(paper, actor(request)); paper.save()
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
        if not paper.blueprint_version_id or paper.blueprint_version.status != 'LOCKED':
            raise ValueError('Đề phải gắn với phiên bản ma trận đã khóa.')
        job = ExamGenerationJob.objects.create(paper=paper, blueprint_version=paper.blueprint_version, status='GENERATING', message='Đang sinh câu hỏi theo từng slot...', requested_by=actor(request), started_at=timezone.now())
        paper.ai_generation_status = 'generating'; paper.ai_generation_message = 'Đang tạo câu hỏi theo ma trận...'; paper.save(update_fields=['ai_generation_status', 'ai_generation_message', 'updated_at'])
        rows = generate_questions_with_ai(paper, actor(request))
        with transaction.atomic():
            paper.questions.all().delete()
            for row in rows:
                ExamQuestion.objects.create(paper=paper, blueprint_slot_id=row.get('blueprintSlotId'), question_type=row.get('questionType', 'single_choice'), score=row.get('score', 1), slot_metadata=row.get('slotMetadata', {}), order=row['order'], content=row['content'], choices=row['choices'], correct_answer=row['correctAnswer'], explanation=row['explanation'], difficulty=row['difficulty'], topic=row['topic'])
            paper._prefetched_objects_cache.pop('questions', None)
            job.status = 'COMPLETED'; job.message = 'Đã sinh đủ câu theo slot.'; job.completed_at = timezone.now(); job.save(update_fields=['status', 'message', 'completed_at'])
            paper.status = ExamPaper.STATUS_AI_REVIEW; paper.ai_generation_status = 'done'; paper.ai_generation_message = 'Đã tạo đề theo ma trận. Bắt buộc chạy kiểm tra AI trước khi nhân viên kiểm tra.'; paper.updated_by = actor(request)
            paper.quality_report = paper_quality_report(paper)
            paper.workflow_log = [*(paper.workflow_log or []), {'action': 'generated', 'actor': actor(request), 'at': timezone.now().isoformat()}]
            paper.save()
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
                updated = normalize_question_for_slot({**replacement, 'order': question.order}, question.order, question.blueprint_slot) if question.blueprint_slot else normalize_question({**replacement, 'order': question.order}, question.order)
                question.content, question.choices, question.correct_answer, question.explanation, question.difficulty, question.topic = updated['content'], updated['choices'], updated['correctAnswer'], updated['explanation'], updated['difficulty'], updated['topic']
                state = 'AI_FIXED'
            question.check_status = state; question.warnings = list(review.get('warnings') or []); question.save()
        paper.quality_report = paper_quality_report(paper)
        ai_passed = not paper.questions.exclude(check_status__in=['PASSED', 'AI_FIXED']).exists()
        paper.status = ExamPaper.STATUS_STAFF_PRECHECK if ai_passed and paper.quality_report.get('passed') else ExamPaper.STATUS_AI_REVIEW
        paper.ai_generation_status = 'done'; paper.ai_generation_message = 'Đã kiểm tra đề.'; paper.updated_by = actor(request); paper.save()
        return Response(serialize_paper(get_paper(pk), include_questions=True))
    except ValueError as exc:
        paper.ai_generation_status = 'error'; paper.ai_generation_message = str(exc)[:500]; paper.save(update_fields=['ai_generation_status', 'ai_generation_message', 'updated_at'])
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'POST'])
@permission_classes([IsManagerOrAdmin])
def paper_reviews(request, pk):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(serialize_paper(paper, include_questions=True))
    if paper.status != ExamPaper.STATUS_PEER_REVIEW:
        return Response({'error': 'Chỉ ghi nhận phản biện khi đề đang ở bước phản biện.'}, status=status.HTTP_409_CONFLICT)
    scope = str(request.data.get('scope') or '').upper()
    verdict = str(request.data.get('verdict') or '').upper()
    if scope not in {ExamReview.SCOPE_QUESTION, ExamReview.SCOPE_PAPER}:
        return Response({'error': 'Chọn phản biện câu hoặc phản biện đề.'}, status=status.HTTP_400_BAD_REQUEST)
    if verdict not in {ExamReview.VERDICT_PASSED, ExamReview.VERDICT_REVISION_REQUIRED}:
        return Response({'error': 'Kết luận phản biện không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    question = None
    if scope == ExamReview.SCOPE_QUESTION:
        question = paper.questions.filter(pk=request.data.get('questionId')).first()
        if not question:
            return Response({'error': 'Phản biện câu phải chọn đúng một câu của đề.'}, status=status.HTTP_400_BAD_REQUEST)
    review = ExamReview.objects.create(
        paper=paper, question=question, scope=scope, verdict=verdict,
        notes=str(request.data.get('notes') or '').strip(), checks=request.data.get('checks') or {}, reviewer=actor(request),
    )
    if verdict == ExamReview.VERDICT_REVISION_REQUIRED:
        paper.status = ExamPaper.STATUS_NEEDS_REVISION
        paper.workflow_log = [*(paper.workflow_log or []), {'action': 'revision_required', 'scope': scope, 'reviewId': str(review.id), 'actor': actor(request), 'at': timezone.now().isoformat()}]
        paper.save(update_fields=['status', 'workflow_log', 'updated_at'])
    return Response(serialize_paper(get_paper(pk), include_questions=True), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_transition(request, pk):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    action = str(request.data.get('action') or '').strip().lower()
    now = timezone.now()
    transitions = {
        'confirm_staff_precheck': (ExamPaper.STATUS_STAFF_PRECHECK, ExamPaper.STATUS_DRAFT_EXPORTED),
        'start_peer_review': (ExamPaper.STATUS_DRAFT_EXPORTED, ExamPaper.STATUS_PEER_REVIEW),
        'approve': (ExamPaper.STATUS_AWAITING_APPROVAL, ExamPaper.STATUS_APPROVED),
        'mark_official_export': (ExamPaper.STATUS_APPROVED, ExamPaper.STATUS_OFFICIAL),
        'bank': (ExamPaper.STATUS_OFFICIAL, ExamPaper.STATUS_BANKED),
    }
    if action == 'submit_approval':
        if paper.status != ExamPaper.STATUS_PEER_REVIEW:
            return Response({'error': 'Đề chưa ở bước phản biện.'}, status=status.HTTP_409_CONFLICT)
        latest_by_question = {}
        latest_paper_review = None
        for review in paper.human_reviews.all().order_by('-updated_at'):
            if review.scope == ExamReview.SCOPE_QUESTION and review.question_id and review.question_id not in latest_by_question:
                latest_by_question[review.question_id] = review
            elif review.scope == ExamReview.SCOPE_PAPER and latest_paper_review is None:
                latest_paper_review = review
        missing = [question.order for question in paper.questions.all() if latest_by_question.get(question.id) is None or latest_by_question[question.id].verdict != ExamReview.VERDICT_PASSED]
        if missing:
            return Response({'error': 'Chưa phản biện đạt cho các câu: ' + ', '.join(map(str, missing[:20]))}, status=status.HTTP_409_CONFLICT)
        if not latest_paper_review or latest_paper_review.verdict != ExamReview.VERDICT_PASSED:
            return Response({'error': 'Chưa có phản biện đề đạt.'}, status=status.HTTP_409_CONFLICT)
        paper.status = ExamPaper.STATUS_AWAITING_APPROVAL
    else:
        expected, destination = transitions.get(action, (None, None))
        if not expected:
            return Response({'error': 'Thao tác quy trình không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        if paper.status != expected:
            return Response({'error': 'Không thể thực hiện thao tác ở trạng thái hiện tại.'}, status=status.HTTP_409_CONFLICT)
        if action == 'confirm_staff_precheck' and not (paper.quality_report or {}).get('passed'):
            return Response({'error': 'Báo cáo chất lượng còn lỗi; chưa thể xác nhận kiểm tra sơ bộ.'}, status=status.HTTP_409_CONFLICT)
        paper.status = destination
        if action == 'confirm_staff_precheck': paper.draft_exported_at = now
        if action == 'approve': paper.approved_at, paper.approved_by = now, actor(request)
        if action == 'mark_official_export': paper.official_exported_at = now
        if action == 'bank': paper.banked_at = now
    paper.updated_by = actor(request)
    paper.workflow_log = [*(paper.workflow_log or []), {'action': action, 'actor': actor(request), 'at': now.isoformat()}]
    paper.save()
    return Response(serialize_paper(get_paper(pk), include_questions=True))


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def paper_chat(request, pk):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    try:
        result = revise_paper_from_chat(
            paper,
            str(request.data.get('message') or ''),
            str(request.data.get('questionId') or '').strip(),
            actor(request),
        )
        changed_ids = []
        with transaction.atomic():
            for change in result['changes']:
                question = paper.questions.filter(pk=change['id']).first()
                if not question:
                    continue
                value = change['question']
                question.content = value['content']
                question.choices = value['choices']
                question.correct_answer = value['correctAnswer']
                question.explanation = value['explanation']
                question.difficulty = value['difficulty']
                question.topic = value['topic']
                question.check_status = 'AI_FIXED'
                question.warnings = []
                question.ai_metadata = {**(question.ai_metadata or {}), 'lastAction': 'paper_chat', 'updatedBy': actor(request)}
                question.save(update_fields=['content', 'choices', 'correct_answer', 'explanation', 'difficulty', 'topic', 'check_status', 'warnings', 'ai_metadata', 'updated_at'])
                changed_ids.append(str(question.id))
            if changed_ids:
                reset_paper_workflow(paper, actor(request))
                paper.save()
        return Response({'reply': result['reply'], 'changedQuestionIds': changed_ids, 'paper': serialize_paper(get_paper(pk), include_questions=True)})
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsManagerOrAdmin])
def paper_export(request, pk, export_type):
    paper = get_paper(pk)
    if not paper:
        return Response({'error': 'Không tìm thấy đề thi.'}, status=status.HTTP_404_NOT_FOUND)
    publication = str(request.query_params.get('publication') or 'draft').lower()
    if publication not in {'draft', 'official'}:
        return Response({'error': 'Loại bản xuất không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    draft_states = {ExamPaper.STATUS_DRAFT_EXPORTED, ExamPaper.STATUS_PEER_REVIEW, ExamPaper.STATUS_AWAITING_APPROVAL, ExamPaper.STATUS_APPROVED, ExamPaper.STATUS_OFFICIAL, ExamPaper.STATUS_BANKED}
    official_states = {ExamPaper.STATUS_APPROVED, ExamPaper.STATUS_OFFICIAL, ExamPaper.STATUS_BANKED}
    if publication == 'draft' and paper.status not in draft_states:
        return Response({'error': 'Nhân viên phải xác nhận kiểm tra sơ bộ trước khi xuất đề nháp.'}, status=status.HTTP_409_CONFLICT)
    if publication == 'official' and paper.status not in official_states:
        return Response({'error': 'Chỉ xuất đề chính thức sau khi đã phê duyệt trên hệ thống.'}, status=status.HTTP_409_CONFLICT)
    name = slugify(paper.title) or 'de-thi'
    if export_type == 'xlsx':
        response = HttpResponse(xlsx_export(paper), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition'] = f'attachment; filename="{name}.xlsx"'; return response
    mode = str(request.query_params.get('mode', 'paper')).lower()
    if mode not in {'paper', 'answers', 'combined'}: mode = 'paper'
    response = HttpResponse(document_export(paper, mode, publication), content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
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
