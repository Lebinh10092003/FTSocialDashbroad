from datetime import date, datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsAuthenticated

from .models import AttendanceRecord


SHIFTS = {
    "OFFICE": {"name": "Ca hành chính", "start": time(8, 0), "end": time(17, 30), "expected": 480},
    "MORNING": {"name": "Ca sáng", "start": time(8, 0), "end": time(12, 0), "expected": 240},
    "AFTERNOON": {"name": "Ca chiều", "start": time(13, 30), "end": time(17, 30), "expected": 240},
    "EVENING": {"name": "Ca tối", "start": time(18, 0), "end": time(22, 0), "expected": 240},
}


def _client_ip(request):
    forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR") or "")
    return (forwarded.split(",", 1)[0].strip() or str(request.META.get("REMOTE_ADDR") or ""))[:64]


def _local(value):
    return timezone.localtime(value) if value else None


def _worked_minutes(item, until=None):
    end = item.clock_out or until
    if not end:
        return 0
    start_local = _local(item.clock_in)
    end_local = _local(end)
    minutes = max(0, int((end_local - start_local).total_seconds() // 60))
    if item.shift_code == "OFFICE":
        break_start = timezone.make_aware(datetime.combine(item.work_date, time(12, 0)))
        break_end = timezone.make_aware(datetime.combine(item.work_date, time(13, 30)))
        overlap = max(timedelta(0), min(end_local, break_end) - max(start_local, break_start))
        minutes = max(0, minutes - int(overlap.total_seconds() // 60))
    return minutes


def _record_status(item, worked_minutes):
    if item.clock_out is None:
        return "WORKING"
    local_in = _local(item.clock_in)
    scheduled = timezone.make_aware(datetime.combine(item.work_date, item.scheduled_start))
    if local_in > scheduled + timedelta(minutes=15):
        return "LATE"
    if worked_minutes < max(0, item.expected_minutes - 15):
        return "INCOMPLETE"
    return "COMPLETE"


def _record_payload(item, now=None):
    worked = _worked_minutes(item, until=now)
    return {
        "id": item.id,
        "employee": {
            "email": item.employee_id,
            "name": item.employee.name or item.employee_id,
            "employeeCode": item.employee.employee_code or "",
            "department": item.employee.department.name if item.employee.department else "",
        },
        "workDate": item.work_date.isoformat(),
        "shiftCode": item.shift_code,
        "shiftName": item.shift_name,
        "scheduledStart": item.scheduled_start.isoformat(timespec="minutes"),
        "scheduledEnd": item.scheduled_end.isoformat(timespec="minutes"),
        "expectedMinutes": item.expected_minutes,
        "clockIn": _local(item.clock_in).isoformat(),
        "clockOut": _local(item.clock_out).isoformat() if item.clock_out else None,
        "workedMinutes": worked,
        "status": _record_status(item, worked),
        "note": item.note,
    }


def _month_range(value):
    try:
        start = datetime.strptime(value, "%Y-%m").date().replace(day=1)
    except (TypeError, ValueError):
        start = timezone.localdate().replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, next_month


def _records_for_request(request, start, end):
    queryset = AttendanceRecord.objects.select_related("employee", "employee__department").filter(work_date__gte=start, work_date__lt=end)
    scope = str(request.query_params.get("scope") or "mine").lower()
    role = getattr(request, "user_role", "EMPLOYEE")
    if scope == "team" and role == "ADMIN":
        return queryset, "team"
    if scope == "team" and role == "MANAGER":
        emails = UserProfile.objects.filter(manager_id=request.user.email).values_list("email", flat=True)
        return queryset.filter(employee_id__in=list(emails) + [request.user.email]), "team"
    return queryset.filter(employee=request.user), "mine"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def attendance_records(request):
    start, end = _month_range(request.query_params.get("month"))
    queryset, scope = _records_for_request(request, start, end)
    now = timezone.now()
    rows = list(queryset.order_by("-work_date", "-clock_in")[:500])
    payloads = [_record_payload(item, now=now) for item in rows]
    mine_open = AttendanceRecord.objects.select_related("employee", "employee__department").filter(employee=request.user, clock_out__isnull=True).order_by("-clock_in").first()
    own_rows = [item for item in rows if item.employee_id == request.user.email] if scope == "team" else rows
    closed_minutes = sum(_worked_minutes(item) for item in own_rows if item.clock_out)
    return Response({
        "serverTime": _local(now).isoformat(),
        "scope": scope,
        "month": start.strftime("%Y-%m"),
        "shifts": [{"code": code, "name": shift["name"], "start": shift["start"].isoformat(timespec="minutes"), "end": shift["end"].isoformat(timespec="minutes"), "expectedMinutes": shift["expected"]} for code, shift in SHIFTS.items()],
        "current": _record_payload(mine_open, now=now) if mine_open else None,
        "records": payloads,
        "summary": {
            "workDays": len({item.work_date for item in own_rows}),
            "totalMinutes": closed_minutes,
            "completedShifts": sum(1 for item in own_rows if item.clock_out),
            "lateShifts": sum(1 for item in own_rows if item.clock_out and _record_status(item, _worked_minutes(item)) == "LATE"),
        },
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def attendance_clock(request):
    action = str(request.data.get("action") or "").upper()
    now = timezone.now()
    if action not in {"IN", "OUT"}:
        return Response({"error": "Thao tác chấm công không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        open_record = AttendanceRecord.objects.select_for_update().filter(employee=request.user, clock_out__isnull=True).order_by("-clock_in").first()
        if action == "OUT":
            if not open_record:
                return Response({"error": "Bạn chưa có ca làm việc đang mở."}, status=status.HTTP_400_BAD_REQUEST)
            open_record.clock_out = now
            open_record.clock_out_ip = _client_ip(request)
            open_record.save(update_fields=["clock_out", "clock_out_ip", "updated_at"])
            open_record = AttendanceRecord.objects.select_related("employee", "employee__department").get(pk=open_record.pk)
            return Response({"message": "Đã ghi nhận giờ ra ca.", "record": _record_payload(open_record)})

        if open_record:
            return Response({"error": f"Bạn đang trong {open_record.shift_name}. Hãy chấm ra trước khi vào ca mới."}, status=status.HTTP_400_BAD_REQUEST)
        shift_code = str(request.data.get("shiftCode") or "OFFICE").upper()
        shift = SHIFTS.get(shift_code)
        if not shift:
            return Response({"error": "Ca làm việc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
        work_date = timezone.localdate(now)
        try:
            item = AttendanceRecord.objects.create(
                employee=request.user,
                work_date=work_date,
                shift_code=shift_code,
                shift_name=shift["name"],
                scheduled_start=shift["start"],
                scheduled_end=shift["end"],
                expected_minutes=shift["expected"],
                clock_in=now,
                note=str(request.data.get("note") or "").strip()[:500],
                clock_in_ip=_client_ip(request),
            )
        except IntegrityError:
            return Response({"error": "Ca này đã được chấm công trong hôm nay."}, status=status.HTTP_400_BAD_REQUEST)
        item = AttendanceRecord.objects.select_related("employee", "employee__department").get(pk=item.pk)
        return Response({"message": "Đã ghi nhận giờ vào ca.", "record": _record_payload(item)}, status=status.HTTP_201_CREATED)
