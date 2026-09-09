from datetime import date, datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsAuthenticated

from .models import AttendanceRecord, TimesheetEntry


# ---------------------------------------------------------------------------
# Legacy shift config (kept for backward compat with old endpoints)
# ---------------------------------------------------------------------------
SHIFTS = {
    "OFFICE": {"name": "Ca hành chính", "start": time(8, 0), "end": time(17, 30), "expected": 480},
    "MORNING": {"name": "Ca sáng", "start": time(8, 0), "end": time(12, 0), "expected": 240},
    "AFTERNOON": {"name": "Ca chiều", "start": time(13, 30), "end": time(17, 30), "expected": 240},
    "EVENING": {"name": "Ca tối", "start": time(18, 0), "end": time(22, 0), "expected": 240},
}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _local(value):
    return timezone.localtime(value) if value else None


def _month_range(value):
    try:
        start = datetime.strptime(value, "%Y-%m").date().replace(day=1)
    except (TypeError, ValueError):
        start = timezone.localdate().replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, next_month


def _parse_time(raw):
    raw = str(raw or "").strip()
    if not raw:
        return None
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    return None


def _is_business_hours(work_date, start_time):
    """Check if the shift start falls within Mon-Fri 8:00-17:30."""
    if work_date.weekday() >= 5:
        return False
    return time(8, 0) <= start_time <= time(17, 30)


# ---------------------------------------------------------------------------
# Timesheet entry payload
# ---------------------------------------------------------------------------
def _entry_payload(entry):
    return {
        "id": entry.id,
        "workDate": entry.work_date.isoformat(),
        "shiftNumber": entry.shift_number,
        "shiftStart": entry.shift_start.isoformat(timespec="minutes"),
        "shiftEnd": entry.shift_end.isoformat(timespec="minutes"),
        "crossesMidnight": entry.crosses_midnight,
        "workMode": entry.work_mode,
        "isDayOff": entry.is_day_off,
        "notes": entry.notes,
        "workedMinutes": entry.worked_minutes,
    }


# ---------------------------------------------------------------------------
# New timesheet endpoints
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def timesheet_list(request):
    """Return timesheet entries for a month, with summary stats."""
    start, end = _month_range(request.query_params.get("month"))
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)

    scope = str(request.query_params.get("scope") or "mine").lower()
    role = getattr(request, "user_role", "EMPLOYEE")
    queryset = TimesheetEntry.objects.select_related("employee", "employee__department").filter(
        work_date__gte=start, work_date__lt=end,
    )
    if scope == "team" and role == "ADMIN":
        pass  # no filter — see all
    elif scope == "team" and role == "MANAGER":
        emails = list(UserProfile.objects.filter(manager_id=request.user.email).values_list("email", flat=True))
        queryset = queryset.filter(employee_id__in=emails + [request.user.email])
    else:
        queryset = queryset.filter(employee=request.user)
        scope = "mine"

    entries = list(queryset.order_by("-work_date", "shift_number")[:2000])
    own_entries = [e for e in entries if e.employee_id == request.user.email] if scope != "mine" else entries

    work_dates = {e.work_date for e in own_entries if not e.is_day_off}
    day_off_dates = {e.work_date for e in own_entries if e.is_day_off}
    online_dates = {e.work_date for e in own_entries if e.work_mode == "online" and not e.is_day_off}
    total_minutes = sum(e.worked_minutes for e in own_entries)

    yesterday_filled = TimesheetEntry.objects.filter(
        employee=request.user, work_date=yesterday,
    ).exists()

    return Response({
        "serverTime": _local(timezone.now()).isoformat(),
        "scope": scope,
        "month": start.strftime("%Y-%m"),
        "entries": [_entry_payload(e) for e in entries],
        "summary": {
            "workDays": len(work_dates),
            "totalMinutes": total_minutes,
            "dayOffCount": len(day_off_dates),
            "onlineDays": len(online_dates),
        },
        "yesterdayFilled": yesterday_filled,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def timesheet_save(request):
    """Save (replace) all shifts for a single day."""
    raw_date = str(request.data.get("workDate") or "").strip()
    try:
        work_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return Response({"error": "Ngày không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    is_day_off = bool(request.data.get("isDayOff"))
    shifts = request.data.get("shifts") or []

    if not is_day_off and not shifts:
        return Response({"error": "Vui lòng thêm ít nhất một ca hoặc đánh dấu nghỉ."}, status=status.HTTP_400_BAD_REQUEST)
    if not is_day_off and len(shifts) > 10:
        return Response({"error": "Tối đa 10 ca trong một ngày."}, status=status.HTTP_400_BAD_REQUEST)

    parsed_shifts = []
    if not is_day_off:
        for idx, shift in enumerate(shifts, start=1):
            start_time = _parse_time(shift.get("start"))
            end_time = _parse_time(shift.get("end"))
            if not start_time or not end_time:
                return Response({"error": f"Ca {idx}: giờ bắt đầu hoặc kết thúc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
            if start_time == end_time:
                return Response({"error": f"Ca {idx}: giờ bắt đầu và kết thúc không được giống nhau."}, status=status.HTTP_400_BAD_REQUEST)
            work_mode = str(shift.get("workMode") or "direct").lower()
            if work_mode not in ("direct", "online"):
                work_mode = "direct"
            notes = str(shift.get("notes") or "").strip()[:500]
            parsed_shifts.append({
                "shift_number": idx,
                "shift_start": start_time,
                "shift_end": end_time,
                "work_mode": work_mode,
                "notes": notes,
            })

    with transaction.atomic():
        TimesheetEntry.objects.filter(employee=request.user, work_date=work_date).delete()
        if is_day_off:
            TimesheetEntry.objects.create(
                employee=request.user,
                work_date=work_date,
                shift_number=1,
                shift_start=time(0, 0),
                shift_end=time(0, 0),
                is_day_off=True,
            )
        else:
            for shift_data in parsed_shifts:
                TimesheetEntry.objects.create(
                    employee=request.user,
                    work_date=work_date,
                    **shift_data,
                )

    saved = list(TimesheetEntry.objects.filter(employee=request.user, work_date=work_date).order_by("shift_number"))
    return Response({
        "message": "Đã lưu công ca." if not is_day_off else "Đã ghi nhận nghỉ làm.",
        "entries": [_entry_payload(e) for e in saved],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def timesheet_prefill(request):
    """Return suggested shifts for the 'Add Timesheet' popup."""
    raw_date = request.query_params.get("date")
    today = timezone.localdate()
    now_local = _local(timezone.now())

    if raw_date:
        try:
            target_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            target_date = today
    else:
        target_date = today

    yesterday = today - timedelta(days=1)
    yesterday_filled = TimesheetEntry.objects.filter(employee=request.user, work_date=yesterday).exists()
    target_filled = TimesheetEntry.objects.filter(employee=request.user, work_date=target_date).exists()

    # Existing entries for the target date (for edit mode)
    existing = list(
        TimesheetEntry.objects.filter(employee=request.user, work_date=target_date).order_by("shift_number")
    )

    # Determine default work mode
    is_weekend = target_date.weekday() >= 5
    default_mode = "online" if is_weekend else "direct"

    # Auto-fill: suggest 2 standard shifts if after 16:00 and yesterday is done
    auto_fill = (
        now_local.hour >= 16
        and yesterday_filled
        and target_date == today
        and not target_filled
    )

    suggested_shifts = []
    if auto_fill:
        suggested_shifts = [
            {"start": "08:00", "end": "12:00", "workMode": default_mode, "notes": ""},
            {"start": "13:30", "end": "17:30", "workMode": default_mode, "notes": ""},
        ]

    return Response({
        "targetDate": target_date.isoformat(),
        "autoFill": auto_fill,
        "shifts": suggested_shifts,
        "yesterdayMissing": not yesterday_filled and target_date == today,
        "yesterdayDate": yesterday.isoformat(),
        "defaultWorkMode": default_mode,
        "existing": [_entry_payload(e) for e in existing],
    })


# ---------------------------------------------------------------------------
# Legacy endpoints (kept for backward compatibility)
# ---------------------------------------------------------------------------
def _client_ip(request):
    forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR") or "")
    return (forwarded.split(",", 1)[0].strip() or str(request.META.get("REMOTE_ADDR") or ""))[:64]


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
