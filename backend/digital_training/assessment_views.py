import json
import math
import re
import secrets
import unicodedata
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.models import SystemConfig
from authentication.permissions import IsAuthenticated

from .assessment_service import (
    append_assessment_deletion_log,
    fetch_google_sheet,
    generate_variants_from_import,
    grade_attempt,
    parse_assessment_workbook,
    prepare_assessment_google_sheet,
    public_questions,
    sync_attempt_to_google_sheet,
    upload_assessment_file_to_drive,
    variants_for,
)
from .models import (
    TrainingAssessment,
    TrainingAssessmentAttempt,
    TrainingAssessmentUpload,
    TrainingQuestionBankSnapshot,
)
from .serializers import (
    TrainingAssessmentAttemptSerializer,
    TrainingAssessmentSerializer,
)
from .views import _actor, _can_manage, _forbidden


def _assessment_error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


QUESTION_BANK_CONFIG_KEY = "digital_training_question_bank"
DEFAULT_QUESTION_BANK_URL = "https://docs.google.com/spreadsheets/d/1zdlpFOO7p93DuQbXpRhvG4xi89u6L7O-2O1UqBaAV3c/edit?usp=sharing"


def _question_bank_settings():
    config, _ = SystemConfig.objects.get_or_create(key=QUESTION_BANK_CONFIG_KEY)
    data = config.data if isinstance(config.data, dict) else {}
    return config, {"default_url": str(data.get("default_url") or DEFAULT_QUESTION_BANK_URL).strip()}


def _question_bank_key(url):
    source = str(url or "").strip()
    match = re.search(r"/(?:spreadsheets|file)/d/([a-zA-Z0-9_-]+)|[?&]id=([a-zA-Z0-9_-]+)", source)
    if match:
        return match.group(1) or match.group(2)
    return re.sub(r"[^a-z0-9]+", "-", source.casefold()).strip("-")[:255]


def _bank_normalized(value):
    text = unicodedata.normalize("NFD", str(value or "").strip().casefold().replace("đ", "d"))
    return "".join(char for char in text if unicodedata.category(char) != "Mn")


def _question_bank_inventory(questions):
    sheets = {}
    for question in questions:
        sheet_name = str(question.get("audience_group") or "Chưa phân nhóm").strip() or "Chưa phân nhóm"
        topic_name = str(question.get("category") or "Chưa phân chủ đề").strip() or "Chưa phân chủ đề"
        sheet = sheets.setdefault(sheet_name, {
            "name": sheet_name, "total": 0, "theory": 0, "practice": 0,
            "easy": 0, "medium": 0, "hard": 0, "topics": {},
        })
        topic = sheet["topics"].setdefault(topic_name, {
            "name": topic_name, "total": 0, "theory": 0, "practice": 0,
            "easy": 0, "medium": 0, "hard": 0,
        })
        normalized_knowledge = _bank_normalized(question.get("knowledge_type"))
        normalized_difficulty = _bank_normalized(question.get("difficulty"))
        for row in (sheet, topic):
            row["total"] += 1
            if normalized_knowledge in {"ly thuyet", "theory"}:
                row["theory"] += 1
            elif normalized_knowledge in {"thuc hanh", "practice"}:
                row["practice"] += 1
            if normalized_difficulty in {"de", "easy"}:
                row["easy"] += 1
            elif normalized_difficulty in {"trung binh", "medium"}:
                row["medium"] += 1
            elif normalized_difficulty in {"kho", "hard"}:
                row["hard"] += 1
    rows = []
    for sheet in sheets.values():
        sheet["topics"] = sorted(sheet["topics"].values(), key=lambda item: _bank_normalized(item["name"]))
        rows.append(sheet)
    return {"sheets": sorted(rows, key=lambda item: _bank_normalized(item["name"]))}


def _snapshot_response(snapshot):
    inventory = snapshot.inventory if isinstance(snapshot.inventory, dict) else {}
    sheets = inventory.get("sheets") if isinstance(inventory.get("sheets"), list) else []
    return {
        "source_url": snapshot.source_url,
        "source_name": snapshot.source_name or snapshot.source_url,
        "source_type": "question_bank_cache",
        "synced_at": snapshot.synced_at,
        "question_count": snapshot.question_count,
        "bank_questions": snapshot.questions if isinstance(snapshot.questions, list) else [],
        "available_groups": [str(item.get("name") or "").strip() for item in sheets if str(item.get("name") or "").strip()],
        "inventory": inventory,
        "errors": [],
        "warnings": [],
        "import_mode": "prepared",
    }


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def question_bank_settings(request):
    if not _can_manage(request):
        return _forbidden()
    config, settings = _question_bank_settings()
    if request.method == "GET":
        return Response(settings)

    default_url = str(request.data.get("default_url") or "").strip()
    if not default_url:
        return _assessment_error("Vui long nhap lien ket ngan hang de thi mac dinh.")
    if not re.match(r"^https?://", default_url, flags=re.IGNORECASE):
        return _assessment_error("Lien ket ngan hang de thi phai bat dau bang http:// hoac https://.")
    config.data = {**(config.data if isinstance(config.data, dict) else {}), "default_url": default_url}
    config.save(update_fields=["data"])
    return Response({"default_url": default_url})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def question_bank_snapshot(request):
    """Return the cached bank, or explicitly refresh it from Google Sheets."""
    if not _can_manage(request):
        return _forbidden()
    _, settings = _question_bank_settings()
    source_url = str(request.data.get("google_sheet_url") or request.query_params.get("google_sheet_url") or settings["default_url"]).strip()
    source_key = _question_bank_key(source_url)
    snapshot = TrainingQuestionBankSnapshot.objects.filter(source_key=source_key).first()
    if request.method == "GET":
        if not snapshot:
            return _assessment_error("Ngân hàng chưa được đồng bộ. Hãy bấm Đồng bộ ngân hàng từ Google Sheet.", status.HTTP_404_NOT_FOUND)
        return Response(_snapshot_response(snapshot))
    if not source_url:
        return _assessment_error("Vui lòng nhập liên kết ngân hàng đề thi.")
    try:
        parsed = parse_assessment_workbook(fetch_google_sheet(source_url), source_url)
        if parsed.get("errors"):
            return _assessment_error(parsed["errors"][0])
        questions = parsed.get("questions") or []
        snapshot, _ = TrainingQuestionBankSnapshot.objects.update_or_create(
            source_key=source_key,
            defaults={
                "source_url": source_url,
                "source_name": source_url,
                "questions": questions,
                "inventory": _question_bank_inventory(questions),
                "question_count": len(questions),
            },
        )
        response = _snapshot_response(snapshot)
        response["warnings"] = parsed.get("warnings") or []
        return Response(response)
    except ValueError as error:
        return _assessment_error(str(error))
    except Exception as error:
        detail = str(error).strip()
        message = "Không thể đồng bộ ngân hàng. Hãy kiểm tra cấu trúc file và quyền chia sẻ."
        return _assessment_error(f"{message} Chi tiết: {detail}" if detail else message)


def _identity_text(value):
    return " ".join(str(value or "").strip().casefold().split())


def _identity_phone(value):
    return re.sub(r"\D", "", str(value or ""))


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
        "participant_count": len(assessment.participants or []),
        "requires_participant": bool(assessment.participants),
        "audience_group": assessment.audience_group,
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
        active_count = item.attempts.filter(status="in_progress").count()
        if active_count:
            return _assessment_error(
                f"Có {active_count} người đang làm bài. Đóng bài trước khi xóa.",
                status.HTTP_409_CONFLICT,
            )
        total_attempts = item.attempts.count()
        force = str(request.data.get("force") or "").strip().lower() in {"true", "1", "yes"}
        if total_attempts and not force:
            return _assessment_error(
                f"Bài có {total_attempts} lượt đã nộp. Gửi thêm force=true để xác nhận xóa toàn bộ.",
                status.HTTP_409_CONFLICT,
            )
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
        use_cached = str(request.data.get("use_cached") or "").strip().lower() in {"1", "true", "yes"}
        if import_mode == "auto_generate" and not uploaded and not google_url:
            _, settings = _question_bank_settings()
            google_url = settings["default_url"]
        if use_cached:
            source_key = _question_bank_key(google_url)
            snapshot = TrainingQuestionBankSnapshot.objects.filter(source_key=source_key).first()
            if not snapshot:
                return _assessment_error("Ngân hàng chưa được đồng bộ. Hãy bấm Đồng bộ ngân hàng từ Google Sheet trước khi tạo đề.", status.HTTP_409_CONFLICT)
            result = {
                "source_name": snapshot.source_name or snapshot.source_url,
                "questions": snapshot.questions if isinstance(snapshot.questions, list) else [],
                "question_count": snapshot.question_count,
                "errors": [],
                "warnings": [],
            }
            source_questions = result["questions"]
            source_type = "question_bank_cache"
            google_url = snapshot.source_url
        elif uploaded:
            if not uploaded.name.lower().endswith((".xlsx", ".xlsm")):
                return _assessment_error("Vui lòng tải file .xlsx hoặc .xlsm.")
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
        if not use_cached:
            result = parse_assessment_workbook(content, source_name)
            source_questions = result["questions"]
        available_groups = sorted({str(item.get("audience_group") or "").strip() for item in source_questions if str(item.get("audience_group") or "").strip()}, key=str.casefold)
        audience_group = str(request.data.get("audience_group") or "").strip()
        if audience_group:
            source_questions = [item for item in source_questions if str(item.get("audience_group") or "").strip().casefold() == audience_group.casefold()]
            if not source_questions:
                return _assessment_error("Nhóm đối tượng không có câu hỏi trong ngân hàng đã chọn.")
        result["bank_questions"] = source_questions
        result["available_groups"] = available_groups
        if import_mode == "auto_generate" and not result["errors"]:
            try:
                participant_count = max(0, int(request.data.get("participant_count") or 0))
                max_people = max(1, int(request.data.get("max_people_per_variant") or 12))
            except (TypeError, ValueError):
                return _assessment_error("So nguoi tham gia hoac so nguoi tren moi ma de khong hop le.")
            structure = request.data.get("structure") or []
            topic_config = request.data.get("topic_config") or []
            knowledge_config = request.data.get("knowledge_config") or {}
            score_config = request.data.get("score_config") or {}
            difficulty_config = request.data.get("difficulty_config") or {}
            if isinstance(structure, str):
                try:
                    structure = json.loads(structure)
                except json.JSONDecodeError:
                    return _assessment_error("Cơ cấu câu hỏi không đúng định dạng JSON.")
            if isinstance(topic_config, str):
                try:
                    topic_config = json.loads(topic_config)
                except json.JSONDecodeError:
                    return _assessment_error("Cơ cấu chủ đề không đúng định dạng JSON.")
            for config_name, config_value in (("knowledge_config", knowledge_config), ("score_config", score_config), ("difficulty_config", difficulty_config)):
                if isinstance(config_value, str):
                    try:
                        parsed = json.loads(config_value)
                    except json.JSONDecodeError:
                        return _assessment_error("Cấu hình tạo đề không đúng định dạng JSON.")
                    if config_name == "knowledge_config":
                        knowledge_config = parsed
                    elif config_name == "score_config":
                        score_config = parsed
                    else:
                        difficulty_config = parsed
            if not isinstance(structure, list) or not isinstance(topic_config, list) or not isinstance(knowledge_config, dict) or not isinstance(score_config, dict) or not isinstance(difficulty_config, dict):
                return _assessment_error("Cấu hình tạo đề không hợp lệ.")
            requested_variant_count = request.data.get("variant_count")
            if requested_variant_count not in (None, ""):
                try:
                    computed_variant_count = int(requested_variant_count)
                except (TypeError, ValueError):
                    return _assessment_error("Số mã đề không hợp lệ.")
            else:
                computed_variant_count = math.ceil(participant_count / max_people) if participant_count else 1
            generated = generate_variants_from_import(
                source_questions,
                computed_variant_count,
                request.data.get("questions_per_variant", 20),
                request.data.get("seed"),
                structure,
                topic_config,
                knowledge_config,
                score_config,
                difficulty_config,
            )
            result.update(generated)
            result["generation_config"].update({
                "participant_count": participant_count,
                "max_people_per_variant": max_people,
                "audience_group": audience_group,
            })
        elif import_mode != "prepared":
            return _assessment_error("Chế độ nhập câu hỏi không hợp lệ.")
        result["import_mode"] = import_mode
        result["source_type"] = source_type
        result["source_url"] = google_url
        return Response(result)
    except ValueError as error:
        return _assessment_error(str(error))
    except Exception as error:
        detail = str(error).strip()
        message = "Khong the doc du lieu ngan hang. Hay kiem tra cau truc file va quyen chia se."
        return _assessment_error(f"{message} Chi tiet: {detail}" if detail else message)


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
    attempt.practical_score = max(Decimal("0"), score - (attempt.auto_graded_points or Decimal("0")))
    attempt.manual_grading_required = False
    if attempt.assessment.output_sheet_url:
        attempt.purge_after = attempt.purge_after or timezone.now() + timedelta(days=7)
        try:
            sync_attempt_to_google_sheet(attempt)
            attempt.sync_status = "synced"
            attempt.sync_error = ""
            attempt.synced_at = timezone.now()
        except Exception as error:
            attempt.sync_status = "error"
            attempt.sync_error = str(error)[:2000]
    attempt.save(update_fields=[
        "score", "practical_score", "manual_grading_required", "sync_status",
        "sync_error", "synced_at", "purge_after", "updated_at",
    ])
    return Response(TrainingAssessmentAttemptSerializer(attempt, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_prepare_output(request, pk):
    if not _can_manage(request):
        return _forbidden()
    assessment = TrainingAssessment.objects.select_related("partner").filter(pk=pk).first()
    if not assessment:
        return _assessment_error("Không tìm thấy đợt kiểm tra.", status.HTTP_404_NOT_FOUND)
    try:
        prepare_assessment_google_sheet(assessment)
        assessment.sync_status = "ready"
        assessment.sync_error = ""
    except Exception as error:
        assessment.sync_status = "error"
        assessment.sync_error = str(error)[:2000]
    assessment.save(update_fields=["sync_status", "sync_error", "updated_at"])
    return Response(TrainingAssessmentSerializer(assessment, context={"request": request}).data)


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
def assessment_result_storage(request, pk, attempt_pk):
    if not _can_manage(request):
        return _forbidden()
    attempt = TrainingAssessmentAttempt.objects.select_related("assessment").filter(pk=attempt_pk, assessment_id=pk).first()
    if not attempt:
        return _assessment_error("Không tìm thấy lượt làm bài.", status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        if attempt.sync_status != "synced":
            return _assessment_error("Chỉ được xóa dữ liệu tạm sau khi đồng bộ Google Sheets thành công.")
        try:
            append_assessment_deletion_log(attempt, _actor(request), "Xóa thủ công", "Dữ liệu tạm đã đồng bộ thành công.")
        except Exception as error:
            return _assessment_error(f"Không thể ghi nhật ký xóa vào Google Sheets: {error}")
        attempt.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    try:
        attempt.purge_after = attempt.purge_after or timezone.now() + timedelta(days=7)
        sync_attempt_to_google_sheet(attempt)
        attempt.sync_status = "synced"
        attempt.sync_error = ""
        attempt.synced_at = timezone.now()
        attempt.purge_after = timezone.now() + timedelta(days=7)
    except Exception as error:
        attempt.sync_status = "error"
        attempt.sync_error = str(error)[:2000]
    attempt.save(update_fields=["sync_status", "sync_error", "synced_at", "purge_after", "updated_at"])
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
        participant_code = str(request.data.get("participant_code") or "").strip()
        assigned_variant = ""
        if assessment.participants:
            participant = next((item for item in assessment.participants if (
                participant_code and str(item.get("code") or "").strip().casefold() == participant_code.casefold()
            ) or (
                email and str(item.get("email") or "").strip().casefold() == email.casefold()
            ) or (
                phone and str(item.get("phone") or "").strip() == phone
            )), None)
            if not participant:
                return _assessment_error("Không tìm thấy người tham gia trong danh sách của đợt kiểm tra.")
            participant_code = str(participant.get("code") or participant_code).strip()
            name = str(participant.get("name") or name).strip()
            email = str(participant.get("email") or email).strip().lower()
            phone = str(participant.get("phone") or phone).strip()
            organization = str(participant.get("organization") or organization).strip()
            assigned_variant = str(participant.get("variant") or "").strip()
        if not name:
            return _assessment_error("Vui lòng nhập họ và tên.")
        if not email and not phone and not participant_code:
            return _assessment_error("Vui lòng nhập email hoặc số điện thoại.")
        phone = _identity_phone(phone)
        if participant_code:
            contact_attempts = assessment.attempts.filter(participant_code__iexact=participant_code)
        elif email:
            contact_attempts = assessment.attempts.filter(email__iexact=email)
        else:
            contact_attempts = assessment.attempts.filter(phone=phone)
        previous = contact_attempts
        if not assessment.participants:
            previous = [
                item for item in previous
                if _identity_text(item.respondent_name) == _identity_text(name)
                and (not email or item.email.casefold() == email.casefold())
                and (not phone or _identity_phone(item.phone) == phone)
            ]
            previous_ids = [item.pk for item in previous]
            previous = assessment.attempts.filter(pk__in=previous_ids)
            if contact_attempts.exists() and not previous.exists():
                return _assessment_error(
                    "Họ tên hoặc thông tin liên hệ chưa khớp với lượt làm trước. Vui lòng nhập đúng thông tin đã dùng.",
                )
        active_attempt = previous.filter(status="in_progress").order_by("-started_at").first()
        if active_attempt:
            active_attempt = _expire_if_needed(active_attempt)
        if active_attempt and active_attempt.status == "in_progress":
            reset_performed = bool(request.data.get("reset"))
            if reset_performed:
                for upload in active_attempt.uploads.all():
                    if upload.file:
                        upload.file.delete(save=False)
                active_attempt.uploads.all().delete()
                active_attempt.answers = {}
                active_attempt.progress = {}
                active_attempt.expires_at = min(
                    timezone.now() + timedelta(minutes=assessment.duration_minutes),
                    assessment.closes_at or timezone.now() + timedelta(days=36500),
                )
                active_attempt.save(update_fields=["answers", "progress", "expires_at", "updated_at"])
            payload = _attempt_payload(active_attempt, request)
            payload["resumed"] = not reset_performed
            payload["reset_performed"] = reset_performed
            return Response(payload)
        if contact_attempts.count() >= assessment.attempt_limit:
            return _assessment_error(f"Bạn đã sử dụng đủ {assessment.attempt_limit} lượt làm bài.")
        variants = variants_for(assessment)
        if not variants:
            return _assessment_error("Bài đánh giá chưa có câu hỏi.")
        if assigned_variant in variants:
            variant = assigned_variant
        else:
            counts = {variant: assessment.attempts.filter(variant=variant).count() for variant in variants}
            minimum = min(counts.values())
            variant = secrets.choice([variant_name for variant_name, count in counts.items() if count == minimum])
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
            participant_code=participant_code,
            variant=variant,
            expires_at=expires_at,
            max_score=maximum,
        )
    return Response(_attempt_payload(attempt, request), status=status.HTTP_201_CREATED)


def _clean_answer_value(value):
    if isinstance(value, list):
        return [str(item)[:500] for item in value[:20] if not isinstance(item, (dict, list))]
    if isinstance(value, dict):
        return {
            str(key)[:100]: str(item)[:5000]
            for key, item in list(value.items())[:30]
            if not isinstance(item, (dict, list))
        }
    return str(value)[:5000]


def _has_answer(question, value):
    if question.get("type") == "matching":
        return (
            isinstance(value, dict)
            and len([item for item in value.values() if str(item or "").strip()])
            == len(question.get("options") or [])
        )
    if question.get("type") == "ordering":
        return (
            isinstance(value, str)
            and len([item for item in value.split("-") if item])
            == len(question.get("options") or [])
        )
    if isinstance(value, list):
        return any(str(item or "").strip() for item in value)
    if isinstance(value, dict):
        return any(str(item or "").strip() for item in value.values())
    return bool(str(value or "").strip())


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
    if attempt.status == "timed_out":
        return Response(_attempt_payload(attempt, request))
    if attempt.status != "in_progress":
        return _assessment_error("Bài đã được nộp hoặc đã hết giờ.")
    allowed_ids = {str(item.get("id")) for item in public_questions(attempt.assessment, attempt.variant)}
    incoming = request.data.get("answers")
    if isinstance(incoming, dict):
        cleaned = {
            str(key): _clean_answer_value(value)
            for key, value in incoming.items()
            if str(key) in allowed_ids
        }
        attempt.answers = {**attempt.answers, **cleaned}
    incoming_progress = request.data.get("progress")
    if isinstance(incoming_progress, dict):
        current_question_id = str(incoming_progress.get("current_question_id") or "")
        reviewed = incoming_progress.get("reviewed_question_ids") or []
        attempt.progress = {
            "current_question_id": current_question_id if current_question_id in allowed_ids else "",
            "reviewed_question_ids": [str(item) for item in reviewed if str(item) in allowed_ids][:500] if isinstance(reviewed, list) else [],
        }
    if request.data.get("submit"):
        required_missing = [
            str(question.get("id"))
            for question in public_questions(attempt.assessment, attempt.variant)
            if question.get("required") and not _has_answer(
                question, attempt.answers.get(str(question.get("id"))),
            )
        ]
        if required_missing:
            return _assessment_error(
                f"Còn {len(required_missing)} câu bắt buộc chưa trả lời.",
            )
        grade_attempt(attempt)
        attempt.status = "submitted"
        attempt.submitted_at = timezone.now()
        attempt.save()
        if attempt.assessment.output_sheet_url:
            attempt.purge_after = timezone.now() + timedelta(days=7)
            try:
                sync_attempt_to_google_sheet(attempt)
                attempt.sync_status = "synced"
                attempt.sync_error = ""
                attempt.synced_at = timezone.now()
            except Exception as error:
                attempt.sync_status = "error"
                attempt.sync_error = str(error)[:2000]
            attempt.save(update_fields=["sync_status", "sync_error", "synced_at", "purge_after", "updated_at"])
    else:
        attempt.save(update_fields=["answers", "progress", "updated_at"])
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
    if not question or question.get("type") not in {"file_upload", "practical_submission"}:
        return _assessment_error("Câu thực hành không hợp lệ.")
    uploaded = request.FILES.get("file")
    if not uploaded:
        return _assessment_error("Vui lòng chọn ảnh.")
    image_only = question.get("type") == "practical_submission"
    maximum_size = 5 if image_only else 10
    if uploaded.size > maximum_size * 1024 * 1024:
        return _assessment_error(f"Tệp không được vượt quá {maximum_size} MB.")
    content_type = str(uploaded.content_type or "").lower()
    allowed_types = {
        "image/jpeg", "image/png", "image/webp", "image/gif",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
    }
    if (image_only and not content_type.startswith("image/")) or (not image_only and content_type not in allowed_types):
        return _assessment_error("Loại tệp không được hỗ trợ. Hãy dùng ảnh, PDF, Word, Excel hoặc TXT.")
    drive_data = {}
    if attempt.assessment.drive_folder_id:
        try:
            drive_data = upload_assessment_file_to_drive(
                uploaded, attempt.assessment, attempt, question_id,
            )
        except Exception as error:
            return _assessment_error(f"Không thể tải tệp lên Google Drive: {error}")
    item = TrainingAssessmentUpload.objects.create(
        attempt=attempt,
        question_id=question_id,
        file=None if drive_data else uploaded,
        drive_file_id=drive_data.get("id", ""),
        drive_url=drive_data.get("url", ""),
        sync_status="drive" if drive_data else "local",
        original_name=uploaded.name,
        content_type=uploaded.content_type or "",
    )
    current_answer = attempt.answers.get(question_id)
    answer_payload = current_answer if isinstance(current_answer, dict) else {"link": str(current_answer or "")}
    upload_url = item.drive_url or (item.file.url if item.file else "")
    answer_payload = {**answer_payload, "upload_id": str(item.id), "upload_file_id": item.drive_file_id, "upload_url": upload_url}
    attempt.answers = {**attempt.answers, question_id: answer_payload}
    attempt.save(update_fields=["answers", "updated_at"])
    return Response({"id": item.id, "file_id": item.drive_file_id, "name": item.original_name, "question_id": question_id, "url": upload_url}, status=status.HTTP_201_CREATED)
