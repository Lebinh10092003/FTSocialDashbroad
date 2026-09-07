from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_time
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsAuthenticated

from .models import WorkItem


VALID_STATUSES = {choice[0] for choice in WorkItem.STATUS_CHOICES}
VALID_PRIORITIES = {choice[0] for choice in WorkItem.PRIORITY_CHOICES}


def _profile_payload(profile):
    return {"email": profile.email, "name": profile.name or profile.email.split("@", 1)[0]}


def _visible_items(user):
    return WorkItem.objects.select_related("creator", "executor", "reviewed_by").prefetch_related("supporters", "managers").filter(
        Q(creator=user) | Q(executor=user) | Q(supporters=user) | Q(managers=user)
    ).distinct()


def _viewer_relation(item, user):
    if item.executor_id == user.email:
        return "executor"
    if any(person.email == user.email for person in item.managers.all()):
        return "manager"
    if any(person.email == user.email for person in item.supporters.all()):
        return "supporter"
    return "creator"


def _can_manage(item, user, role):
    return role == "ADMIN" or item.creator_id == user.email or any(person.email == user.email for person in item.managers.all())


def _payload(item, user, role):
    relation = _viewer_relation(item, user)
    display_status = item.status
    title_prefix = ""
    if relation in {"manager", "creator"} and item.status == WorkItem.STATUS_COMPLETED:
        display_status = WorkItem.STATUS_TODO
        title_prefix = "Kiểm tra kết quả công việc: "
    elif relation == "supporter":
        title_prefix = "Hỗ trợ/theo dõi: "
    elif relation in {"manager", "creator"}:
        title_prefix = "Quản lý: "
    if relation == "executor" and item.needs_revision and item.status != WorkItem.STATUS_REVIEWED:
        title_prefix = "Bổ sung: "
    can_manage = _can_manage(item, user, role)
    return {
        "id": item.id,
        "title": item.title,
        "displayTitle": f"{title_prefix}{item.title}",
        "description": item.description,
        "date": item.work_date.isoformat(),
        "startTime": item.start_time.isoformat(timespec="minutes") if item.start_time else "",
        "endTime": item.end_time.isoformat(timespec="minutes") if item.end_time else "",
        "status": item.status,
        "displayStatus": display_status,
        "priority": item.priority,
        "label": item.label,
        "creator": _profile_payload(item.creator),
        "executor": _profile_payload(item.executor),
        "supporters": [_profile_payload(person) for person in item.supporters.all()],
        "managers": [_profile_payload(person) for person in item.managers.all()],
        "viewerRelation": relation,
        "needsRevision": item.needs_revision,
        "revisionCount": item.revision_count,
        "reviewPercent": item.review_percent,
        "reviewNote": item.review_note,
        "reviewedBy": _profile_payload(item.reviewed_by) if item.reviewed_by else None,
        "reviewedAt": item.reviewed_at.isoformat() if item.reviewed_at else None,
        "canEdit": can_manage or relation == "executor",
        "canDelete": role == "ADMIN" or item.creator_id == user.email or (relation == "manager"),
        "canReview": can_manage and item.status == WorkItem.STATUS_COMPLETED,
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
    if creating and request.user_role in {"ADMIN", "MANAGER"} and executor.email != request.user.email and request.user.email not in {p.email for p in managers}:
        managers.append(request.user)

    item.title = title[:255]
    item.description = str(data.get("description", item.description if item else "") or "").strip()
    item.work_date = work_date
    item.start_time = start_time
    item.end_time = end_time
    item.status = requested_status
    item.priority = requested_priority
    item.label = str(data.get("label", item.label if item else "Công việc") or "Công việc").strip()[:100]
    item.executor = executor
    item.save()
    item.supporters.set(supporters)
    item.managers.set(managers)
    return None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def work_items(request):
    if request.method == "POST":
        item = WorkItem(creator=request.user, executor=request.user, work_date=timezone.localdate(), title="")
        error = _apply_data(request, item, creating=True)
        if error:
            return error
        item = _visible_items(request.user).get(pk=item.pk)
        return Response({"message": "Đã thêm công việc.", "item": _payload(item, request.user, request.user_role)}, status=status.HTTP_201_CREATED)

    rows = _visible_items(request.user)
    start = parse_date(str(request.query_params.get("start") or ""))
    end = parse_date(str(request.query_params.get("end") or ""))
    if start:
        rows = rows.filter(work_date__gte=start)
    if end:
        rows = rows.filter(work_date__lte=end)
    rows = list(rows.order_by("work_date", "start_time", "created_at")[:1000])
    return Response({"items": [_payload(item, request.user, request.user_role) for item in rows]})


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def work_item_detail(request, item_id):
    item = _visible_items(request.user).filter(pk=item_id).first()
    if not item:
        return Response({"error": "Không tìm thấy công việc."}, status=status.HTTP_404_NOT_FOUND)
    payload = _payload(item, request.user, request.user_role)
    if request.method == "GET":
        return Response(payload)
    if request.method == "DELETE":
        if not payload["canDelete"]:
            return Response({"error": "Bạn không có quyền xóa công việc này."}, status=status.HTTP_403_FORBIDDEN)
        item.delete()
        return Response({"message": "Đã xóa công việc."})
    if not payload["canEdit"]:
        return Response({"error": "Bạn không có quyền cập nhật công việc này."}, status=status.HTTP_403_FORBIDDEN)
    error = _apply_data(request, item, allow_people=_can_manage(item, request.user, request.user_role))
    if error:
        return error
    item = _visible_items(request.user).get(pk=item.pk)
    return Response({"message": "Đã cập nhật công việc.", "item": _payload(item, request.user, request.user_role)})


def _review(item, request, action):
    if not _can_manage(item, request.user, request.user_role) or item.status != WorkItem.STATUS_COMPLETED:
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
        item.status = WorkItem.STATUS_DOING
        item.needs_revision = True
        item.revision_count += 1
    elif action == "confirm":
        item.status = WorkItem.STATUS_REVIEWED
        item.needs_revision = False
    else:
        return Response({"error": "Thao tác review không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    item.save()
    return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def work_item_review(request, item_id):
    item = _visible_items(request.user).filter(pk=item_id).first()
    if not item:
        return Response({"error": "Không tìm thấy công việc."}, status=status.HTTP_404_NOT_FOUND)
    error = _review(item, request, str(request.data.get("action") or ""))
    if error:
        return error
    item = _visible_items(request.user).get(pk=item.pk)
    return Response({"message": "Đã cập nhật kết quả review.", "item": _payload(item, request.user, request.user_role)})


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
    items = list(_visible_items(request.user).filter(id__in=ids))
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
        if any(not _can_manage(item, request.user, request.user_role) or item.status != WorkItem.STATUS_COMPLETED for item in items):
            return Response({"error": "Có công việc chưa sẵn sàng hoặc bạn không có quyền review."}, status=status.HTTP_403_FORBIDDEN)
    with transaction.atomic():
        if action == "delete":
            denied = [item.id for item in items if not _payload(item, request.user, request.user_role)["canDelete"]]
            if denied:
                return Response({"error": "Bạn không có quyền xóa toàn bộ công việc đã chọn."}, status=status.HTTP_403_FORBIDDEN)
            WorkItem.objects.filter(id__in=ids).delete()
        elif action == "status":
            next_status = str(request.data.get("status") or "")
            if next_status not in {WorkItem.STATUS_TODO, WorkItem.STATUS_DOING, WorkItem.STATUS_COMPLETED}:
                return Response({"error": "Trạng thái hàng loạt không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
            if any(not _payload(item, request.user, request.user_role)["canEdit"] for item in items):
                return Response({"error": "Bạn không có quyền sửa toàn bộ công việc đã chọn."}, status=status.HTTP_403_FORBIDDEN)
            WorkItem.objects.filter(id__in=ids).update(status=next_status, updated_at=timezone.now())
        elif action in {"request_revision", "confirm"}:
            for item in items:
                error = _review(item, request, action)
                if error:
                    return error
        else:
            return Response({"error": "Thao tác hàng loạt không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"message": f"Đã cập nhật {len(ids)} công việc.", "updated": len(ids)})
