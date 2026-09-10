import hashlib
import json
from datetime import timedelta

from django.db.models import Max
from django.utils import timezone

from authentication.notifications import notify_workspace

from .assessment_service import prepare_assessment_google_sheet, rebuild_assessment_google_sheet_rows, variants_for
from .models import TrainingAssessment


RETENTION_DAYS = 30
DRAFT_TRASH_DAYS = 3


def assessment_retention_anchor(assessment):
    """Return the real end of the test, including a safe fallback for legacy rows."""
    if assessment.closes_at:
        return assessment.closes_at
    if assessment.closed_at:
        return assessment.closed_at
    if assessment.status not in {"closed", "graded", "backup_complete"}:
        return None
    completed = assessment.attempts.filter(status__in=["submitted", "timed_out"]).aggregate(
        last_submitted=Max("submitted_at"), last_expiry=Max("expires_at")
    )
    candidates = [value for value in completed.values() if value]
    if candidates:
        return max(candidates)
    base = assessment.opens_at or assessment.created_at
    return base + timedelta(minutes=max(1, assessment.duration_minutes or 1)) if base else None


def refresh_assessment_status(assessment):
    """Promote a closed assessment once every submitted answer has been graded."""
    if assessment.status not in {"closed", "graded", "backup_complete"}:
        return assessment
    completed = assessment.attempts.filter(status__in=["submitted", "timed_out"])
    if completed.exists() and not completed.filter(manual_grading_required=True).exists():
        if assessment.status == "closed":
            assessment.status = "graded"
        assessment.graded_at = assessment.graded_at or timezone.now()
        assessment.save(update_fields=["status", "graded_at", "updated_at"])
    return assessment


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def verify_assessment_backup(assessment, *, rebuild=True):
    """Rebuild and then prove that questions, answers and durable media links exist in Sheet."""
    if not assessment.output_sheet_url:
        raise ValueError("Bài kiểm tra chưa có Google Sheet đáp án.")
    if assessment.attempts.filter(status="in_progress").exists():
        raise ValueError("Vẫn còn người đang làm bài; chưa thể chốt bản sao cuối cùng.")
    if assessment.attempts.filter(status__in=["submitted", "timed_out"], manual_grading_required=True).exists():
        raise ValueError("Vẫn còn bài chưa chấm; chưa thể xác nhận bản sao cuối cùng.")
    resources = prepare_assessment_google_sheet(assessment) if rebuild else None
    service, spreadsheet_id, layout = rebuild_assessment_google_sheet_rows(assessment, resources)
    errors = []
    expected_question_ids = set()
    for variant in variants_for(assessment):
        expected = [item for item in assessment.questions if str(item.get("variant") or "") == variant]
        rows = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{layout['question_sheets'][variant]}'!A2:R"
        ).execute().get("values", [])
        by_id = {str(row[1]): row for row in rows if len(row) > 1 and str(row[1]).strip()}
        for question in expected:
            question_id = str(question.get("id") or "")
            expected_question_ids.add(question_id)
            row = by_id.get(question_id)
            if not row:
                errors.append(f"Thiếu câu hỏi {question_id} ({variant}) trong Sheet.")
                continue
            try:
                raw = json.loads(row[17])
            except (IndexError, TypeError, json.JSONDecodeError):
                errors.append(f"Câu hỏi {question_id} chưa có bản JSON đầy đủ.")
                continue
            if _canonical(raw) != _canonical(question):
                errors.append(f"Dữ liệu câu hỏi {question_id} chưa khớp bản trên web.")

    expected_attempt_tokens = set()
    for variant in variants_for(assessment):
        rows = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{layout['answer_sheets'][variant]}'!A2:ZZ"
        ).execute().get("values", [])
        by_token = {str(row[6]): row for row in rows if len(row) > 6 and str(row[6]).strip()}
        for attempt in assessment.attempts.filter(variant=variant).exclude(status="in_progress"):
            token = str(attempt.access_token)
            expected_attempt_tokens.add(token)
            row = by_token.get(token)
            if not row:
                errors.append(f"Thiếu bài làm {token} trong Sheet.")
                continue
            try:
                raw = json.loads(row[-1])
            except (TypeError, json.JSONDecodeError):
                errors.append(f"Bài làm {token} chưa có bản JSON đầy đủ.")
                continue
            expected_raw = {
                "answers": attempt.answers or {}, "progress": attempt.progress or {},
                "grading": attempt.grading or {}, "grading_notes": attempt.grading_notes or [],
            }
            if _canonical(raw) != _canonical(expected_raw):
                errors.append(f"Dữ liệu bài làm {token} chưa khớp bản trên web.")
            for upload in attempt.uploads.all():
                if upload.file and not upload.drive_url:
                    errors.append(f"Tệp {upload.original_name} của bài làm {token} chưa có liên kết sao lưu Drive.")

    manifest = {
        "verifiedAt": timezone.now().isoformat(),
        "questionCount": len(expected_question_ids),
        "attemptCount": len(expected_attempt_tokens),
        "questionHash": hashlib.sha256(_canonical(assessment.questions or []).encode("utf-8")).hexdigest(),
        "errors": errors[:100],
    }
    assessment.backup_manifest = manifest
    if errors:
        assessment.sync_status = "error"
        assessment.sync_error = " ".join(errors[:5])[:2000]
        assessment.save(update_fields=["backup_manifest", "sync_status", "sync_error", "updated_at"])
        return False, manifest
    assessment.status = "backup_complete"
    assessment.backup_completed_at = timezone.now()
    assessment.sync_status = "synced"
    assessment.sync_error = ""
    assessment.attempts.exclude(status="in_progress").update(sync_status="synced", sync_error="", synced_at=timezone.now())
    assessment.save(update_fields=["status", "backup_completed_at", "backup_manifest", "sync_status", "sync_error", "updated_at"])
    return True, manifest


def lifecycle_warning(assessment, now=None):
    now = now or timezone.now()
    anchor = assessment_retention_anchor(assessment)
    if not anchor or assessment.trashed_at:
        return None
    days = max(0, (now.date() - anchor.date()).days)
    remaining = max(0, RETENTION_DAYS - days)
    ungraded = assessment.attempts.filter(status__in=["submitted", "timed_out"], manual_grading_required=True).exists()
    if days >= 28:
        return {"level": "urgent", "label": f"Dữ liệu sẽ bị xóa sau {remaining} ngày", "days": days, "remaining": remaining}
    if ungraded and days >= 21:
        return {"level": "strong", "label": f"Chưa chấm · dữ liệu sẽ bị xóa sau {remaining} ngày", "days": days, "remaining": remaining}
    if ungraded and days >= 14:
        return {"level": "warning", "label": "Hãy chấm bài", "days": days, "remaining": remaining}
    return None


def emit_lifecycle_notification(assessment, warning):
    organization = assessment.partner.name if assessment.partner else "chưa xác định"
    anchor = assessment_retention_anchor(assessment)
    work_date = (assessment.opens_at or assessment.created_at).astimezone().strftime("%d/%m/%Y")
    if warning["days"] >= 28:
        message = f"Bài kiểm tra cuối khóa tập huấn của đơn vị {organization} làm ngày {work_date} sẽ bị xóa sau {warning['remaining']} ngày. Vui lòng hoàn tất chấm và sao lưu."
        milestone = 28
    elif warning["days"] >= 21:
        message = f"Bài kiểm tra cuối khóa tập huấn của đơn vị {organization} làm ngày {work_date} vẫn chưa được chấm; dữ liệu sẽ bị xóa sau {warning['remaining']} ngày."
        milestone = 21
    else:
        message = f"Bài kiểm tra cuối khóa tập huấn của đơn vị {organization} làm ngày {work_date} hiện vẫn chưa được chấm, vui lòng kiểm tra và chấm bài."
        milestone = 14
    notify_workspace(
        event_key=f"assessment:{assessment.pk}:retention:{milestone}",
        title=warning["label"], message=message,
        severity="urgent" if milestone >= 21 else "warning",
        category="digital-training", target_modules=["digital-training"],
        action_url=f"/training-assessments/{assessment.pk}",
    )


def trash_draft(assessment):
    now = timezone.now()
    assessment.trashed_at = now
    assessment.purge_at = now + timedelta(days=DRAFT_TRASH_DAYS)
    assessment.save(update_fields=["trashed_at", "purge_at", "updated_at"])


def run_assessment_lifecycle(now=None):
    now = now or timezone.now()
    result = {"warned": 0, "backedUp": 0, "deleted": 0, "failedBackup": 0, "purgedDrafts": 0}
    for assessment in TrainingAssessment.objects.filter(trashed_at__isnull=True).iterator():
        if assessment.status == "published" and assessment.closes_at and assessment.closes_at <= now:
            assessment.status = "closed"
            assessment.closed_at = assessment.closes_at
            assessment.attempts.filter(status="in_progress").update(status="timed_out", submitted_at=now)
            assessment.save(update_fields=["status", "closed_at", "updated_at"])
        refresh_assessment_status(assessment)
        warning = lifecycle_warning(assessment, now)
        if warning:
            emit_lifecycle_notification(assessment, warning)
            result["warned"] += 1
        anchor = assessment_retention_anchor(assessment)
        if not anchor or now < anchor + timedelta(days=RETENTION_DAYS):
            continue
        try:
            ok, _ = verify_assessment_backup(assessment, rebuild=True)
        except Exception as error:
            ok = False
            assessment.sync_status = "error"
            assessment.sync_error = str(error)[:2000]
            assessment.save(update_fields=["sync_status", "sync_error", "updated_at"])
        if not ok:
            result["failedBackup"] += 1
            notify_workspace(
                event_key=f"assessment:{assessment.pk}:backup-failed-before-hard-delete",
                title="Khẩn cấp: sao lưu lỗi trước khi xóa",
                message=(
                    f"Bài “{assessment.title}” của đơn vị "
                    f"{assessment.partner.name if assessment.partner else 'chưa xác định'} đã đủ 30 ngày. "
                    "Bản Google Sheet có thể chưa đầy đủ nhưng dữ liệu trên hệ thống vẫn bị xóa hoàn toàn theo chính sách lưu trữ."
                ),
                severity="urgent", category="digital-training", target_modules=["digital-training"],
                action_url="/training-assessments",
            )
        else:
            result["backedUp"] += 1
        assessment_id = assessment.pk
        title = assessment.title
        assessment.delete()
        result["deleted"] += 1
        notify_workspace(
            event_key=f"assessment:{assessment_id}:retention-deleted",
            title="Đã xóa bài kiểm tra đủ 30 ngày",
            message=f"Bài “{title}” đã được xóa hoàn toàn khỏi hệ thống theo chính sách lưu trữ tối đa 30 ngày.",
            severity="warning", category="digital-training", target_modules=["digital-training"],
            action_url="/training-assessments",
        )
    stale_drafts = TrainingAssessment.objects.filter(trashed_at__isnull=False, purge_at__lte=now)
    result["purgedDrafts"] = stale_drafts.count()
    stale_drafts.delete()
    return result
