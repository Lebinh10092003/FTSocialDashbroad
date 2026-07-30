import secrets
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.permissions import IsAuthenticated

from .assessment_service import (
    fetch_google_sheet,
    generate_variants_from_import,
    grade_attempt,
    parse_assessment_workbook,
    public_questions,
    variants_for,
)
from .models import (
    TrainingAssessment,
    TrainingAssessmentAttempt,
    TrainingAssessmentUpload,
)
from .serializers import (
    TrainingAssessmentAttemptSerializer,
    TrainingAssessmentSerializer,
)
from .views import _actor, _can_manage, _forbidden


def _assessment_error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


def _availability(assessment):
    now = timezone.now()
    if assessment.status == "draft":
        return "draft", "Bài đánh giá chưa được phát hành."
    if assessment.status == "closed":
        return "closed", "Bài đánh giá đã đóng."
    if assessment.opens_at and now < assessment.opens_at:
        return "upcoming", "Bài đánh giá chưa đến thời gian mở."
    if assessment.closes_at and now >= assessment.closes_at:
        return "closed", "Bài đánh giá đã hết thời gian nhận bài."
    return "open", ""


def _public_assessment(assessment):
    availability, message = _availability(assessment)
    return {
        "title": assessment.title,
        "slug": assessment.public_slug,
        "partner_name": assessment.partner.name if assessment.partner else "",
        "class_name": assessment.training_class.name if assessment.training_class else "",
        "session_name": assessment.session.title if assessment.session else "",
        "description": assessment.description,
        "instructions": assessment.instructions,
        "duration_minutes": assessment.duration_minutes,
        "attempt_limit": assessment.attempt_limit,
        "opens_at": assessment.opens_at,
        "closes_at": assessment.closes_at,
        "variant_count": len(variants_for(assessment)),
        "question_count": max(
            (len(public_questions(assessment, variant)) for variant in variants_for(assessment)),
            default=0,
        ),
        "availability": availability,
        "message": message,
    }


def _attempt_payload(attempt, request):
    data = TrainingAssessmentAttemptSerializer(attempt, context={"request": request}).data
    data["access_token"] = str(attempt.access_token)
    data["assessment"] = _public_assessment(attempt.assessment)
    data["questions"] = public_questions(attempt.assessment, attempt.variant)
    return data


def _expire_if_needed(attempt):
    if attempt.status == "in_progress" and timezone.now() >= attempt.expires_at:
        grade_attempt(attempt)
        attempt.status = "timed_out"
        attempt.submitted_at = timezone.now()
        attempt.save(update_fields=[
            "score", "max_score", "auto_graded_points", "manual_grading_required",
            "status", "submitted_at", "updated_at",
        ])
    return attempt


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def assessments(request):
    queryset = TrainingAssessment.objects.select_related("session", "partner", "training_class").all()
    if request.method == "GET":
        return Response(TrainingAssessmentSerializer(queryset, many=True, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    serializer = TrainingAssessmentSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    item = serializer.save(created_by=_actor(request))
    return Response(TrainingAssessmentSerializer(item, context={"request": request}).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def assessment_detail(request, pk):
    item = TrainingAssessment.objects.select_related("session", "partner", "training_class").filter(pk=pk).first()
    if not item:
        return _assessment_error("Không tìm thấy bài đánh giá.", status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(TrainingAssessmentSerializer(item, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    if request.method == "DELETE":
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = TrainingAssessmentSerializer(item, data=request.data, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    updated = serializer.save()
    return Response(TrainingAssessmentSerializer(updated, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def assessment_import_preview(request):
    if not _can_manage(request):
        return _forbidden()
    uploaded = request.FILES.get("file")
    google_url = str(request.data.get("google_sheet_url") or "").strip()
    import_mode = str(request.data.get("import_mode") or "prepared").strip()
    try:
        if uploaded:
            if not uploaded.name.lower().endswith(".xlsx"):
                return _assessment_error("Vui lòng tải file .xlsx.")
            if uploaded.size > 10 * 1024 * 1024:
                return _assessment_error("File XLSX không được vượt quá 10 MB.")
            content = uploaded.read()
            source_name = uploaded.name
            source_type = "xlsx"
        elif google_url:
            content = fetch_google_sheet(google_url)
            source_name = google_url
            source_type = "google_sheet"
        else:
            return _assessment_error("Vui lòng chọn file XLSX hoặc nhập đường dẫn Google Sheet.")
        result = parse_assessment_workbook(content, source_name)
        if import_mode == "auto_generate" and not result["errors"]:
            generated = generate_variants_from_import(
                result["questions"],
                request.data.get("variant_count", 5),
                request.data.get("questions_per_variant", 20),
                request.data.get("seed"),
            )
            result.update(generated)
        elif import_mode != "prepared":
            return _assessment_error("Chế độ nhập câu hỏi không hợp lệ.")
        result["import_mode"] = import_mode
        result["source_type"] = source_type
        return Response(result)
    except ValueError as error:
        return _assessment_error(str(error))
    except Exception:
        return _assessment_error("Không thể đọc dữ liệu. Hãy kiểm tra lại cấu trúc file và quyền chia sẻ.")


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def assessment_results(request, pk):
    assessment = TrainingAssessment.objects.filter(pk=pk).first()
    if not assessment:
        return _assessment_error("Không tìm thấy bài đánh giá.", status.HTTP_404_NOT_FOUND)
    attempts = assessment.attempts.prefetch_related("uploads").all()
    return Response(TrainingAssessmentAttemptSerializer(attempts, many=True, context={"request": request}).data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def assessment_result_grade(request, pk, attempt_pk):
    if not _can_manage(request):
        return _forbidden()
    attempt = TrainingAssessmentAttempt.objects.filter(pk=attempt_pk, assessment_id=pk).first()
    if not attempt:
        return _assessment_error("Không tìm thấy lượt làm bài.", status.HTTP_404_NOT_FOUND)
    try:
        score = Decimal(str(request.data.get("score")))
    except (InvalidOperation, TypeError):
        return _assessment_error("Điểm không hợp lệ.")
    if score < 0 or score > attempt.max_score:
        return _assessment_error("Điểm phải nằm trong thang điểm của bài.")
    attempt.score = score
    attempt.manual_grading_required = False
    attempt.save(update_fields=["score", "manual_grading_required", "updated_at"])
    return Response(TrainingAssessmentAttemptSerializer(attempt, context={"request": request}).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def public_assessment(request, slug):
    assessment = TrainingAssessment.objects.select_related("session", "partner", "training_class").filter(public_slug=slug).first()
    if not assessment:
        return _assessment_error("Đường dẫn bài đánh giá không tồn tại.", status.HTTP_404_NOT_FOUND)
    return Response(_public_assessment(assessment))


@api_view(["POST"])
@permission_classes([AllowAny])
def public_assessment_start(request, slug):
    with transaction.atomic():
        assessment = TrainingAssessment.objects.select_for_update().select_related("session", "partner", "training_class").filter(public_slug=slug).first()
        if not assessment:
            return _assessment_error("Đường dẫn bài đánh giá không tồn tại.", status.HTTP_404_NOT_FOUND)
        availability, message = _availability(assessment)
        if availability != "open":
            return _assessment_error(message)
        name = str(request.data.get("respondent_name") or "").strip()
        email = str(request.data.get("email") or "").strip().lower()
        phone = str(request.data.get("phone") or "").strip()
        organization = str(request.data.get("organization") or "").strip()
        if not name:
            return _assessment_error("Vui lòng nhập họ và tên.")
        if not email and not phone:
            return _assessment_error("Vui lòng nhập email hoặc số điện thoại.")
        previous = assessment.attempts.filter(email=email) if email else assessment.attempts.filter(phone=phone)
        if previous.count() >= assessment.attempt_limit:
            return _assessment_error(f"Bạn đã sử dụng đủ {assessment.attempt_limit} lượt làm bài.")
        variants = variants_for(assessment)
        if not variants:
            return _assessment_error("Bài đánh giá chưa có câu hỏi.")
        counts = {variant: assessment.attempts.filter(variant=variant).count() for variant in variants}
        minimum = min(counts.values())
        variant = secrets.choice([name for name, count in counts.items() if count == minimum])
        expires_at = timezone.now() + timedelta(minutes=assessment.duration_minutes)
        if assessment.closes_at and expires_at > assessment.closes_at:
            expires_at = assessment.closes_at
        questions = public_questions(assessment, variant)
        maximum = sum(Decimal(str(item.get("points") or 0)) for item in questions)
        attempt = TrainingAssessmentAttempt.objects.create(
            assessment=assessment,
            respondent_name=name,
            email=email,
            phone=phone,
            organization=organization,
            variant=variant,
            expires_at=expires_at,
            max_score=maximum,
        )
    return Response(_attempt_payload(attempt, request), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH"])
@permission_classes([AllowAny])
def public_attempt(request, token):
    attempt = TrainingAssessmentAttempt.objects.select_related(
        "assessment", "assessment__session", "assessment__partner", "assessment__training_class"
    ).prefetch_related("uploads").filter(access_token=token).first()
    if not attempt:
        return _assessment_error("Phiên làm bài không tồn tại.", status.HTTP_404_NOT_FOUND)
    attempt = _expire_if_needed(attempt)
    if request.method == "GET":
        return Response(_attempt_payload(attempt, request))
    if attempt.status != "in_progress":
        return _assessment_error("Bài đã được nộp hoặc đã hết giờ.")
    allowed_ids = {str(item.get("id")) for item in public_questions(attempt.assessment, attempt.variant)}
    incoming = request.data.get("answers")
    if isinstance(incoming, dict):
        cleaned = {
            str(key): str(value)[:5000]
            for key, value in incoming.items()
            if str(key) in allowed_ids and not isinstance(value, (dict, list))
        }
        attempt.answers = {**attempt.answers, **cleaned}
    if request.data.get("submit"):
        grade_attempt(attempt)
        attempt.status = "submitted"
        attempt.submitted_at = timezone.now()
        attempt.save()
    else:
        attempt.save(update_fields=["answers", "updated_at"])
    return Response(_attempt_payload(attempt, request))


@api_view(["POST"])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser])
def public_attempt_upload(request, token):
    attempt = TrainingAssessmentAttempt.objects.select_related("assessment").filter(access_token=token).first()
    if not attempt:
        return _assessment_error("Phiên làm bài không tồn tại.", status.HTTP_404_NOT_FOUND)
    attempt = _expire_if_needed(attempt)
    if attempt.status != "in_progress":
        return _assessment_error("Bài đã được nộp hoặc đã hết giờ.")
    question_id = str(request.data.get("question_id") or "")
    question = next(
        (item for item in public_questions(attempt.assessment, attempt.variant) if str(item.get("id")) == question_id),
        None,
    )
    if not question or question.get("type") != "file_upload":
        return _assessment_error("Câu thực hành không hợp lệ.")
    uploaded = request.FILES.get("file")
    if not uploaded:
        return _assessment_error("Vui lòng chọn ảnh.")
    if uploaded.size > 5 * 1024 * 1024:
        return _assessment_error("Ảnh không được vượt quá 5 MB.")
    if not str(uploaded.content_type or "").startswith("image/"):
        return _assessment_error("Chỉ chấp nhận tệp hình ảnh.")
    item = TrainingAssessmentUpload.objects.create(
        attempt=attempt,
        question_id=question_id,
        file=uploaded,
        original_name=uploaded.name,
        content_type=uploaded.content_type or "",
    )
    attempt.answers = {**attempt.answers, question_id: f"upload:{item.id}"}
    attempt.save(update_fields=["answers", "updated_at"])
    return Response({"id": item.id, "name": item.original_name, "question_id": question_id}, status=status.HTTP_201_CREATED)
