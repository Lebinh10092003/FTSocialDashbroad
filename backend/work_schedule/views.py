import hmac
import logging
import os
from datetime import timedelta

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_time
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsAuthenticated

from .models import WorkItem, WorkScheduleSheetInboundEvent
from .training_sync import delete_training_for_work_item, sync_training_from_work_item

logger = logging.getLogger(__name__)


VALID_STATUSES = {choice[0] for choice in WorkItem.STATUS_CHOICES}
VALID_PRIORITIES = {choice[0] for choice in WorkItem.PRIORITY_CHOICES}


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def work_schedule_sync(request):
    from .sheet_sync import initial_two_way_sync, sync_status, sync_to_sheet

    if request.method == "GET":
        return Response(sync_status())
    try:
        direction = str(request.data.get("direction") or "both")
        if direction == "to-sheet":
            result = sync_to_sheet(getattr(request, "google_access_token", None))
        else:
            if request.user_role not in {"ADMIN", "MANAGER"}:
                return Response({"error": "Chỉ quản lý hoặc admin được chạy lượt đồng bộ hai chiều toàn hệ thống."}, status=status.HTTP_403_FORBIDDEN)
            result = initial_two_way_sync(getattr(request, "google_access_token", None))
        return Response({"message": "Đồng bộ lịch làm việc thành công.", "result": result})
    except Exception as exc:
        return Response({"error": f"Không thể đồng bộ Google Sheets: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)


def _profile_payload(profile):
    return {"email": profile.email, "name": profile.name or profile.email.split("@", 1)[0]}


def _related_items(user):
    rows = WorkItem.objects.select_related("creator", "executor", "reviewed_by").prefetch_related("supporters", "managers")
    return rows.filter(
        Q(creator=user) | Q(executor=user) | Q(supporters=user) | Q(managers=user)
    ).distinct()


def _visible_items(user, role=None):
    rows = WorkItem.objects.select_related("creator", "executor", "reviewed_by").prefetch_related("supporters", "managers")
    return rows if role == "ADMIN" else _related_items(user)


def _viewer_relation(item, user):
    if item.executor_id == user.email:
        return "executor"
    if any(person.email == user.email for person in item.managers.all()):
        return "manager"
    if any(person.email == user.email for person in item.supporters.all()):
        return "supporter"
    if item.creator_id == user.email:
        return "creator"
    return "team_viewer"


def _can_manage(item, user, role):
    return (
        role == "ADMIN"
        or item.creator_id == user.email
        or any(person.email == user.email for person in item.managers.all())
    )


def _next_daily_order(executor, work_date, exclude_id=None):
    rows = WorkItem.objects.filter(executor=executor, work_date=work_date)
    if exclude_id:
        rows = rows.exclude(pk=exclude_id)
    return (rows.aggregate(highest=Max("daily_order"))["highest"] or 0) + 1


def _normalize_daily_order(executor_id, work_date):
    rows = WorkItem.objects.filter(executor_id=executor_id, work_date=work_date).order_by(
        "daily_order", "start_time", "created_at", "pk"
    )
    for order, row in enumerate(rows, start=1):
        if row.daily_order != order:
            WorkItem.objects.filter(pk=row.pk).update(daily_order=order)


def _payload(item, user, role):
    relation = _viewer_relation(item, user)
    can_view_review = role == "ADMIN" or relation in {"manager", "creator"}
    display_status = item.status
    title_prefix = ""
    if relation == "manager" and item.status == WorkItem.STATUS_COMPLETED and not item.reviewed_at:
        display_status = WorkItem.STATUS_TODO
        title_prefix = "Kiểm tra kết quả công việc: "
    elif relation == "supporter":
        title_prefix = "Hỗ trợ/theo dõi: "
    elif relation == "manager":
        title_prefix = "Quản lý: "
    if relation == "executor" and item.needs_revision and item.status != WorkItem.STATUS_REVIEWED:
        title_prefix = "Bổ sung: "
    can_manage = _can_manage(item, user, role)
    return {
        "id": item.id,
        "title": item.title,
        "displayTitle": f"{title_prefix}{item.title}",
        "description": item.description,
        "progressNote": item.progress_note,
        "date": item.work_date.isoformat(),
        "startTime": item.start_time.isoformat(timespec="minutes") if item.start_time else "",
        "endTime": item.end_time.isoformat(timespec="minutes") if item.end_time else "",
        "status": item.status,
        "displayStatus": display_status,
        "priority": item.priority,
        "label": item.label,
        "dailyOrder": item.daily_order,
        "trainingSessionId": item.training_session_id,
        "creator": _profile_payload(item.creator),
        "executor": _profile_payload(item.executor),
        "supporters": [_profile_payload(person) for person in item.supporters.all()],
        "managers": [_profile_payload(person) for person in item.managers.all()],
        "viewerRelation": relation,
        "needsRevision": item.needs_revision,
        "revisionCount": item.revision_count,
        "revisionOfId": item.revision_of_id,
        "reviewPercent": item.review_percent if can_view_review else None,
        "reviewNote": item.review_note if can_view_review else "",
        "reviewedBy": _profile_payload(item.reviewed_by) if can_view_review and item.reviewed_by else None,
        "reviewedAt": item.reviewed_at.isoformat() if can_view_review and item.reviewed_at else None,
        "canEdit": (can_manage or relation == "executor") and not item.reviewed_at,
        "canDelete": role == "ADMIN" or item.creator_id == user.email or relation == "manager",
        "canReview": can_view_review and can_manage and item.status == WorkItem.STATUS_COMPLETED and not item.reviewed_at,
        "canManagePeople": can_manage or relation == "executor",
        "createdAt": item.created_at.isoformat(),
        "updatedAt": item.updated_at.isoformat(),
    }


def _profiles(emails, field_label):
    if not isinstance(emails, list):
        return None, Response({"error": f"{field_label} không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    clean = list(dict.fromkeys(str(value or "").strip().lower() for value in emails if str(value or "").strip()))
    profiles = list(UserProfile.objects.filter(email__in=clean, employment_status="ACTIVE"))
    if len(profiles) != len(clean):
        return None, Response({"error": f"Có {field_label.lower()} không tồn tại hoặc đã ngừng hoạt động."}, status=status.HTTP_400_BAD_REQUEST)
    return profiles, None


def _apply_data(request, item, creating=False, allow_people=True):
    data = request.data or {}
    title = str(data.get("title", item.title if item else "") or "").strip()
    raw_date = data.get("date", item.work_date.isoformat() if item else "")
    work_date = parse_date(str(raw_date or ""))
    executor_email = str(data.get("executorEmail", item.executor_id if item else request.user.email) if allow_people else item.executor_id).strip().lower()
    executor = UserProfile.objects.filter(email=executor_email, employment_status="ACTIVE").first()
    if not title:
        return Response({"error": "Vui lòng nhập tên công việc."}, status=status.HTTP_400_BAD_REQUEST)
    if not work_date:
        return Response({"error": "Vui lòng chọn ngày thực hiện."}, status=status.HTTP_400_BAD_REQUEST)
    if not executor:
        return Response({"error": "Người thực hiện là bắt buộc và phải đang hoạt động."}, status=status.HTTP_400_BAD_REQUEST)

    start_raw = str(data.get("startTime", item.start_time.isoformat(timespec="minutes") if item and item.start_time else "") or "").strip()
    end_raw = str(data.get("endTime", item.end_time.isoformat(timespec="minutes") if item and item.end_time else "") or "").strip()
    start_time = parse_time(start_raw) if start_raw else None
    end_time = parse_time(end_raw) if end_raw else None
    if (start_raw and not start_time) or (end_raw and not end_time):
        return Response({"error": "Thời gian thực hiện không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if start_time and end_time and end_time <= start_time:
        return Response({"error": "Giờ kết thúc phải sau giờ bắt đầu."}, status=status.HTTP_400_BAD_REQUEST)

    requested_status = str(data.get("status", item.status if item else WorkItem.STATUS_TODO) or "").lower()
    requested_priority = str(data.get("priority", item.priority if item else "medium") or "").lower()
    if requested_status not in VALID_STATUSES or requested_status == WorkItem.STATUS_REVIEWED:
        return Response({"error": "Trạng thái công việc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if requested_priority not in VALID_PRIORITIES:
        return Response({"error": "Mức ưu tiên không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    current_supporters = [person.email for person in item.supporters.all()] if item and item.pk else []
    current_managers = [person.email for person in item.managers.all()] if item and item.pk else []
    supporters, error = _profiles(data.get("supporterEmails", current_supporters) if allow_people else current_supporters, "Người hỗ trợ/theo dõi")
    if error:
        return error
    managers, error = _profiles(data.get("managerEmails", current_managers) if allow_people else current_managers, "Người quản lý")
    if error:
        return error
    supporters = [person for person in supporters if person.email != executor.email]
    managers = [person for person in managers if person.email != executor.email]
    if creating and request.user_role == "MANAGER" and executor.email != request.user.email and request.user.email not in {p.email for p in managers}:
        managers.append(request.user)

    previous_group = (item.executor_id, item.work_date) if item and item.pk else None
    next_group = (executor.email, work_date)
    item.title = title[:1000]
    item.description = str(data.get("description", item.description if item else "") or "").strip()
    item.progress_note = str(data.get("progressNote", item.progress_note if item else "") or "").strip()[:1000]
    item.work_date = work_date
    item.start_time = start_time
    item.end_time = end_time
    item.status = requested_status
    item.priority = requested_priority
    item.label = str(data.get("label", item.label if item else "Công việc") or "Công việc").strip()[:100]
    item.executor = executor
    if creating or previous_group != next_group:
        item.daily_order = _next_daily_order(executor, work_date, item.pk)
    item.save()
    item.supporters.set(supporters)
    item.managers.set(managers)
    sync_training_from_work_item(item)
    if previous_group and previous_group != next_group:
        _normalize_daily_order(*previous_group)
    return None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def work_items(request):
    if request.method == "POST":
        item = WorkItem(creator=request.user, executor=request.user, work_date=timezone.localdate(), title="")
        error = _apply_data(request, item, creating=True)
        if error:
            return error
        item = _visible_items(request.user, request.user_role).get(pk=item.pk)
        return Response({"message": "Đã thêm công việc.", "item": _payload(item, request.user, request.user_role)}, status=status.HTTP_201_CREATED)

    rows = _related_items(request.user)
    start = parse_date(str(request.query_params.get("start") or ""))
    end = parse_date(str(request.query_params.get("end") or ""))
    if start:
        rows = rows.filter(work_date__gte=start)
    if end:
        rows = rows.filter(work_date__lte=end)
    rows = list(rows.order_by("work_date", "daily_order", "start_time", "created_at")[:1000])
    return Response({"items": [_payload(item, request.user, request.user_role) for item in rows]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def work_team(request):
    rows = UserProfile.objects.filter(employment_status="ACTIVE")
    if request.user_role != "ADMIN":
        rows = rows.filter(manager=request.user)
    rows = rows.select_related("department", "job_title").order_by("name", "email")
    member_ids = list(rows.values_list("email", flat=True))
    team_items = WorkItem.objects.select_related("creator", "executor", "reviewed_by").prefetch_related("supporters", "managers").filter(
        executor_id__in=member_ids
    ).order_by("work_date", "daily_order", "start_time", "created_at")[:2000]
    return Response({"members": [
        {
            "email": profile.email,
            "name": profile.name or profile.email.split("@", 1)[0],
            "employeeCode": profile.employee_code or "",
            "department": profile.department.name if profile.department else "",
            "jobTitle": profile.job_title.name if profile.job_title else "",
        }
        for profile in rows
    ], "items": [_payload(item, request.user, request.user_role) for item in team_items]})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def work_day_edit(request):
    """Update the table representation of one day without coupling notes to status."""
    work_date = parse_date(str(request.data.get("date") or ""))
    rows = request.data.get("items")
    raw_delete_ids = request.data.get("deleteIds", [])
    if not work_date:
        return Response({"error": "Ngày làm việc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(rows, list) or len(rows) > 100:
        return Response({"error": "Danh sách nhiệm vụ không hợp lệ hoặc vượt quá 100 nhiệm vụ."}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(raw_delete_ids, list):
        return Response({"error": "Danh sách nhiệm vụ cần xóa không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        delete_ids = list(dict.fromkeys(int(value) for value in raw_delete_ids))
    except (TypeError, ValueError):
        return Response({"error": "Mã nhiệm vụ cần xóa không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if not rows and not delete_ids:
        return Response({"error": "Không có thay đổi để lưu."}, status=status.HTTP_400_BAD_REQUEST)

    existing_ids = []
    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            return Response({"error": "Dữ liệu nhiệm vụ không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
        title = str(row.get("title") or "").strip()
        if not title:
            return Response({"error": "Nội dung nhiệm vụ không được để trống."}, status=status.HTTP_400_BAD_REQUEST)
        row_status = str(row.get("status") or "").strip().lower() if "status" in row else None
        if row_status is not None and row_status not in VALID_STATUSES:
            return Response({"error": "Trạng thái nhiệm vụ không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
        normalized = {
            "title": title[:1000],
            "progress_note": str(row.get("progressNote") or "").strip()[:1000],
            "status": row_status,
        }
        if row.get("id") is not None:
            try:
                normalized["id"] = int(row["id"])
                existing_ids.append(normalized["id"])
            except (TypeError, ValueError):
                return Response({"error": "Mã nhiệm vụ không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
        normalized_rows.append(normalized)
    if len(existing_ids) != len(set(existing_ids)):
        return Response({"error": "Danh sách có nhiệm vụ bị trùng."}, status=status.HTTP_400_BAD_REQUEST)
    if set(existing_ids) & set(delete_ids):
        return Response({"error": "Một nhiệm vụ không thể vừa cập nhật vừa xóa."}, status=status.HTTP_400_BAD_REQUEST)

    requested_ids = existing_ids + delete_ids
    visible = {item.id: item for item in _visible_items(request.user, request.user_role).filter(id__in=requested_ids)}
    if len(visible) != len(requested_ids):
        return Response({"error": "Có nhiệm vụ không tồn tại hoặc bạn không được truy cập."}, status=status.HTTP_403_FORBIDDEN)
    if any(item.work_date != work_date for item in visible.values()):
        return Response({"error": "Có nhiệm vụ không thuộc ngày đang chỉnh sửa."}, status=status.HTTP_400_BAD_REQUEST)
    for row in normalized_rows:
        if "id" not in row:
            continue
        item = visible[row["id"]]
        can_edit = _payload(item, request.user, request.user_role)["canEdit"]
        status_changed = row["status"] is not None and row["status"] != item.status
        if (row["title"] != item.title or status_changed) and not can_edit:
            return Response({"error": f"Bạn không có quyền sửa nội dung hoặc trạng thái nhiệm vụ số {item.daily_order}."}, status=status.HTTP_403_FORBIDDEN)
    for item_id in delete_ids:
        item = visible[item_id]
        if not _payload(item, request.user, request.user_role)["canDelete"]:
            return Response({"error": f"Bạn không có quyền xóa nhiệm vụ số {item.daily_order}."}, status=status.HTTP_403_FORBIDDEN)

    updated_ids = []
    with transaction.atomic():
        for row in normalized_rows:
            if "id" not in row:
                if row["status"] == WorkItem.STATUS_REVIEWED:
                    return Response({"error": "Nhiệm vụ mới không thể ở trạng thái đã review."}, status=status.HTTP_400_BAD_REQUEST)
                item = WorkItem.objects.create(
                    creator=request.user,
                    executor=request.user,
                    title=row["title"],
                    progress_note=row["progress_note"],
                    work_date=work_date,
                    status=row["status"] or WorkItem.STATUS_TODO,
                    priority="medium",
                    label="Công việc",
                    daily_order=_next_daily_order(request.user, work_date),
                )
            else:
                item = visible[row["id"]]
                update_fields = ["progress_note", "updated_at"]
                item.progress_note = row["progress_note"]
                if row["title"] != item.title:
                    item.title = row["title"]
                    update_fields.append("title")
                if row["status"] is not None and row["status"] != item.status:
                    item.status = row["status"]
                    update_fields.append("status")
                item.save(update_fields=update_fields)
                sync_training_from_work_item(item)
            updated_ids.append(item.id)
        affected_groups = set()
        for item_id in delete_ids:
            item = visible[item_id]
            affected_groups.add((item.executor_id, item.work_date))
            delete_training_for_work_item(item)
            item.delete()
        for executor_id, date in affected_groups:
            _normalize_daily_order(executor_id, date)

    refreshed = list(_visible_items(request.user, request.user_role).filter(id__in=updated_ids).order_by("daily_order", "created_at"))
    return Response({
        "message": "Đã cập nhật bảng lịch trong ngày.",
        "items": [_payload(item, request.user, request.user_role) for item in refreshed],
    })


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def work_item_detail(request, item_id):
    item = _visible_items(request.user, request.user_role).filter(pk=item_id).first()
    if not item:
        return Response({"error": "Không tìm thấy công việc."}, status=status.HTTP_404_NOT_FOUND)
    payload = _payload(item, request.user, request.user_role)
    if request.method == "GET":
        return Response(payload)
    if request.method == "DELETE":
        if not payload["canDelete"]:
            return Response({"error": "Bạn không có quyền xóa công việc này."}, status=status.HTTP_403_FORBIDDEN)
        old_group = (item.executor_id, item.work_date)
        delete_training_for_work_item(item)
        item.delete()
        _normalize_daily_order(*old_group)
        return Response({"message": "Đã xóa công việc."})
    if "progressNote" in request.data and set(request.data.keys()).issubset({"progressNote"}):
        item.progress_note = str(request.data.get("progressNote") or "").strip()[:1000]
        item.save(update_fields=["progress_note", "updated_at"])
        return Response({"message": "Đã lưu ghi chú tiến trình.", "item": _payload(item, request.user, request.user_role)})
    if not payload["canEdit"]:
        return Response({"error": "Bạn không có quyền cập nhật công việc này."}, status=status.HTTP_403_FORBIDDEN)
    error = _apply_data(
        request,
        item,
        allow_people=_can_manage(item, request.user, request.user_role) or item.executor_id == request.user.email,
    )
    if error:
        return error
    item = _visible_items(request.user, request.user_role).get(pk=item.pk)
    return Response({"message": "Đã cập nhật công việc.", "item": _payload(item, request.user, request.user_role)})


def _review(item, request, action):
    if not _can_manage(item, request.user, request.user_role) or item.status != WorkItem.STATUS_COMPLETED or item.reviewed_at:
        return Response({"error": "Công việc chưa sẵn sàng hoặc bạn không có quyền review."}, status=status.HTTP_403_FORBIDDEN)
    try:
        review_percent = int(request.data.get("reviewPercent"))
    except (TypeError, ValueError):
        return Response({"error": "Vui lòng nhập mức độ hoàn thành từ 0 đến 100%."}, status=status.HTTP_400_BAD_REQUEST)
    if review_percent < 0 or review_percent > 100:
        return Response({"error": "Mức độ hoàn thành phải từ 0 đến 100%."}, status=status.HTTP_400_BAD_REQUEST)
    item.review_percent = review_percent
    item.review_note = str(request.data.get("reviewNote") or "").strip()[:1000]
    item.reviewed_by = request.user
    item.reviewed_at = timezone.now()
    if action == "request_revision":
        item.revision_count += 1
        item.save()
        sync_training_from_work_item(item)
        revision = WorkItem.objects.create(
            creator=request.user,
            executor=item.executor,
            title=item.title,
            description=item.review_note or item.description,
            work_date=item.work_date + timedelta(days=1),
            start_time=item.start_time,
            end_time=item.end_time,
            status=WorkItem.STATUS_DOING,
            priority=item.priority,
            label=item.label,
            daily_order=_next_daily_order(item.executor, item.work_date + timedelta(days=1)),
            needs_revision=True,
            revision_count=item.revision_count,
            revision_of=item,
        )
        revision.supporters.set(item.supporters.all())
        revision.managers.set(item.managers.all())
        sync_training_from_work_item(revision)
        return revision
    elif action == "confirm":
        item.status = WorkItem.STATUS_REVIEWED
        item.needs_revision = False
    else:
        return Response({"error": "Thao tác review không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    item.save()
    sync_training_from_work_item(item)
    return item


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def work_item_review(request, item_id):
    item = _visible_items(request.user, request.user_role).filter(pk=item_id).first()
    if not item:
        return Response({"error": "Không tìm thấy công việc."}, status=status.HTTP_404_NOT_FOUND)
    with transaction.atomic():
        result = _review(item, request, str(request.data.get("action") or ""))
        if isinstance(result, Response):
            return result
    item = _visible_items(request.user, request.user_role).get(pk=item.pk)
    response = {"message": "Đã cập nhật kết quả review.", "item": _payload(item, request.user, request.user_role)}
    if result and result.pk != item.pk:
        response["revisionItem"] = _payload(_visible_items(request.user, request.user_role).get(pk=result.pk), request.user, request.user_role)
    return Response(response)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def work_items_batch(request):
    raw_ids = request.data.get("ids") or []
    try:
        ids = list(dict.fromkeys(int(value) for value in raw_ids))
    except (TypeError, ValueError):
        return Response({"error": "Danh sách công việc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if not ids or len(ids) > 200:
        return Response({"error": "Vui lòng chọn từ 1 đến 200 công việc."}, status=status.HTTP_400_BAD_REQUEST)
    items = list(_visible_items(request.user, request.user_role).filter(id__in=ids))
    if len(items) != len(ids):
        return Response({"error": "Có công việc không tồn tại hoặc bạn không được truy cập."}, status=status.HTTP_403_FORBIDDEN)
    action = str(request.data.get("action") or "")
    if action in {"request_revision", "confirm"}:
        try:
            review_percent = int(request.data.get("reviewPercent"))
        except (TypeError, ValueError):
            return Response({"error": "Vui lòng nhập mức độ hoàn thành từ 0 đến 100%."}, status=status.HTTP_400_BAD_REQUEST)
        if review_percent < 0 or review_percent > 100:
            return Response({"error": "Mức độ hoàn thành phải từ 0 đến 100%."}, status=status.HTTP_400_BAD_REQUEST)
        if any(
            not _can_manage(item, request.user, request.user_role)
            or item.status != WorkItem.STATUS_COMPLETED
            or item.reviewed_at
            for item in items
        ):
            return Response({"error": "Có công việc chưa sẵn sàng hoặc bạn không có quyền review."}, status=status.HTTP_403_FORBIDDEN)
    with transaction.atomic():
        if action == "delete":
            denied = [item.id for item in items if not _payload(item, request.user, request.user_role)["canDelete"]]
            if denied:
                return Response({"error": "Bạn không có quyền xóa toàn bộ công việc đã chọn."}, status=status.HTTP_403_FORBIDDEN)
            groups = {(item.executor_id, item.work_date) for item in items}
            for item in items:
                delete_training_for_work_item(item)
            WorkItem.objects.filter(id__in=ids).delete()
            for group in groups:
                _normalize_daily_order(*group)
        elif action == "status":
            next_status = str(request.data.get("status") or "")
            if next_status not in {WorkItem.STATUS_TODO, WorkItem.STATUS_DOING, WorkItem.STATUS_COMPLETED}:
                return Response({"error": "Trạng thái hàng loạt không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
            if any(not _payload(item, request.user, request.user_role)["canEdit"] for item in items):
                return Response({"error": "Bạn không có quyền sửa toàn bộ công việc đã chọn."}, status=status.HTTP_403_FORBIDDEN)
            WorkItem.objects.filter(id__in=ids).update(status=next_status, updated_at=timezone.now())
            for item in WorkItem.objects.filter(id__in=ids):
                sync_training_from_work_item(item)
        elif action == "date":
            work_date = parse_date(str(request.data.get("date") or ""))
            if not work_date:
                return Response({"error": "Vui lòng chọn ngày thực hiện hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
            if any(not _payload(item, request.user, request.user_role)["canEdit"] for item in items):
                return Response({"error": "Bạn không có quyền đổi ngày toàn bộ công việc đã chọn."}, status=status.HTTP_403_FORBIDDEN)
            old_groups = {(item.executor_id, item.work_date) for item in items}
            for item in sorted(items, key=lambda row: (row.executor_id, row.daily_order, row.pk)):
                if item.work_date == work_date:
                    continue
                item.work_date = work_date
                item.daily_order = _next_daily_order(item.executor, work_date, item.pk)
                item.save(update_fields=["work_date", "daily_order", "updated_at"])
                sync_training_from_work_item(item)
            for group in old_groups:
                _normalize_daily_order(*group)
        elif action in {"add_supporters", "add_managers"}:
            people, error = _profiles(request.data.get("emails") or [], "Nhân sự")
            if error:
                return error
            if not people:
                return Response({"error": "Vui lòng chọn ít nhất một nhân sự."}, status=status.HTTP_400_BAD_REQUEST)
            if any(not _payload(item, request.user, request.user_role)["canManagePeople"] for item in items):
                return Response({"error": "Bạn không có quyền phân công toàn bộ công việc đã chọn."}, status=status.HTTP_403_FORBIDDEN)
            for item in items:
                related = [person for person in people if person.email != item.executor_id]
                if action == "add_supporters":
                    item.supporters.add(*related)
                else:
                    item.managers.add(*related)
        elif action in {"request_revision", "confirm"}:
            for item in items:
                result = _review(item, request, action)
                if isinstance(result, Response):
                    return result
        else:
            return Response({"error": "Thao tác hàng loạt không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"message": f"Đã cập nhật {len(ids)} công việc.", "updated": len(ids)})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def work_schedule_sheet_webhook(request):
    """Realtime Sheet -> Web sync. Called by the Apps Script `onEdit` trigger for exactly
    one edited row (never a full-sheet scan). Authenticated by a shared secret header
    instead of a user token, since Apps Script cannot hold a logged-in session."""
    from .sheet_sync import _ingest_row, _service, ensure_sync_columns, push_groups_to_sheet
    from .signals import suppress_sheet_queue

    expected_secret = os.getenv("SHEET_WEBHOOK_SECRET", "")
    provided_secret = request.headers.get("X-Sheet-Webhook-Secret", "")
    if not expected_secret or not hmac.compare_digest(provided_secret, expected_secret):
        return Response({"error": "Không xác thực được webhook."}, status=status.HTTP_401_UNAUTHORIZED)

    event_id = str(request.data.get("event_id") or "").strip()
    row_number = request.data.get("row")
    values = request.data.get("values")
    if not event_id or not isinstance(row_number, int) or row_number < 2 or not isinstance(values, list):
        return Response({"error": "Payload thiếu event_id/row/values hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    event, created = WorkScheduleSheetInboundEvent.objects.get_or_create(
        event_id=event_id,
        defaults={"row_number": row_number, "payload": {"row": row_number, "values": values}, "status": WorkScheduleSheetInboundEvent.STATUS_PROCESSED},
    )
    if not created and event.status == WorkScheduleSheetInboundEvent.STATUS_PROCESSED:
        return Response({
            "message": "Sự kiện đã được xử lý trước đó (bỏ qua để tránh trùng lặp).",
            "status": event.status,
            "createdCount": event.created_count,
            "updatedCount": event.updated_count,
        })
    if not created:
        # Previous attempt for this event_id failed (Apps Script retryFailedOutboxRows sends
        # the same event_id again) — refresh the snapshot and actually retry instead of
        # silently returning the stale failure as if it were a duplicate no-op.
        event.row_number = row_number
        event.payload = {"row": row_number, "values": values}
        event.error = ""
        event.save(update_fields=["row_number", "payload", "error"])

    row = [str(value) for value in values]
    try:
        with transaction.atomic():
            with suppress_sheet_queue():
                created_count, updated_count, touched = _ingest_row(row_number, row, timezone.localdate())
            event.status = WorkScheduleSheetInboundEvent.STATUS_PROCESSED
            event.created_count = created_count
            event.updated_count = updated_count
            event.processed_at = timezone.now()
            event.save(update_fields=["status", "created_count", "updated_count", "processed_at"])
    except Exception as exc:
        event.status = WorkScheduleSheetInboundEvent.STATUS_FAILED
        event.error = str(exc)
        event.processed_at = timezone.now()
        event.save(update_fields=["status", "error", "processed_at"])
        logger.exception("Không thể xử lý sự kiện webhook từ Sheet (event_id=%s, row=%s).", event_id, row_number)
        return Response({"error": f"Không thể xử lý sự kiện từ Sheet: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

    push_back_error = ""
    if touched:
        try:
            service = _service(None)
            ensure_sync_columns(service)
            push_groups_to_sheet(service, touched, force=True)
        except Exception as exc:
            push_back_error = str(exc)
            logger.exception("Ghi lại WEB_TASK_IDS lên Sheet thất bại sau webhook (event_id=%s).", event_id)
            event.error = f"Ghi ngược task_id lên Sheet thất bại: {exc}"
            event.save(update_fields=["error"])

    return Response({
        "message": "Đã đồng bộ dòng từ Sheet vào hệ thống.",
        "createdCount": created_count,
        "updatedCount": updated_count,
        "groups": [[email, work_date.isoformat()] for email, work_date in touched],
        "pushBackError": push_back_error,
    })
