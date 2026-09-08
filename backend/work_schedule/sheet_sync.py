import json
import re
import uuid
from calendar import monthrange
from contextlib import contextmanager
from datetime import datetime, timedelta

from django.db import models, transaction
from django.utils import timezone

from authentication.models import SystemConfig, UserProfile
from integrations.google_sheets import build_sheets_service

from .models import WorkItem, WorkScheduleSheetChange, WorkScheduleSheetSyncLease
from .sheet_parser import assessment_notes, parse_sheet_tasks, status_from_note, training_end
from .signals import suppress_sheet_queue


SPREADSHEET_ID = "1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc"
SHEET_NAME = "Lịch công tác"
SHEET_ID = 1443841670
EMPLOYEE_EMAILS = {
    "EMP-0FA847B0": "dungpv@fermat.edu.vn",
    "EMP-198EA04B": "liennt@fermat.edu.vn",
    "EMP-AECADFA4": "hanh@fermat.edu.vn",
    "EMP-9864ED57": "binhlv@fermat.edu.vn",
    "EMP-AA0FCF6E": "phongnt@fermat.edu.vn",
    "EMP-564CB158": "phuongnt@fermat.edu.vn",
    "EMP-000A3BD2": "tienthm@fermat.edu.vn",
    "EMP-ABD98A8B": "sondc@fermat.edu.vn",
    "EMP-9EC1EEB6": "hadk1@fermat.edu.vn",
}
EMAIL_EMPLOYEES = {email: employee_id for employee_id, email in EMPLOYEE_EMAILS.items()}
WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"]


def deterministic_sheet_uid(row_number, task_index):
    return uuid.UUID(f"6ae71379-0000-5000-8000-{row_number:06x}{task_index:06x}")


def _service(google_token=None):
    main = SystemConfig.objects.filter(key="main").first()
    config_data = main.data if main and isinstance(main.data, dict) else {}
    token = google_token or (main.last_google_access_token if main else None)
    return build_sheets_service(token, config_data)


def _rows(service):
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{SHEET_NAME}'!A2:K6109",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    return result.get("values", [])


def _cell(row, index):
    return str(row[index] if index < len(row) else "").strip()


def _parse_date(value):
    for pattern in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), pattern).date()
        except (TypeError, ValueError):
            pass
    return None


def _task_uids(value):
    result = []
    for line in str(value or "").splitlines():
        match = re.match(r"^\s*\d+\s*[.)]\s*([0-9a-fA-F-]{32,36})\s*$", line)
        if not match:
            result.append(None)
            continue
        try:
            result.append(uuid.UUID(match.group(1)))
        except ValueError:
            result.append(None)
    return result


def _numbered(values):
    return "\n".join(f"{index}. {value}" for index, value in enumerate(values, 1))


def _group_values(items):
    content = _numbered([
        f"{item.start_time.strftime('%H:%M')}: {item.title}" if item.start_time else item.title
        for item in items
    ])
    all_completed = bool(items) and all(
        item.status in {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED}
        for item in items
    )
    self_notes = "Hoàn thành" if all_completed else "\n".join(
        f"{index}. {item.progress_note or 'Hoàn thành'}"
        for index, item in enumerate(items, 1)
        if item.progress_note or item.status in {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED}
    )
    all_reviewed = bool(items) and all(item.status == WorkItem.STATUS_REVIEWED for item in items)
    leader_notes = "Hoàn thành" if all_reviewed else "\n".join(
        f"{index}. " +
        (f"{item.review_percent}%" if item.review_percent is not None else "Hoàn thành") +
        (f" · {item.review_note}" if item.review_note else "")
        for index, item in enumerate(items, 1)
        if item.status == WorkItem.STATUS_REVIEWED
    )
    task_ids = _numbered([str(item.sync_uid) for item in items])
    return content, self_notes, leader_notes, task_ids


def _row_hash(content, self_notes, leader_notes, task_ids):
    raw = json.dumps([content, self_notes, leader_notes, task_ids], ensure_ascii=False, separators=(",", ":"))
    value = 2166136261
    for character in raw:
        value ^= ord(character)
        value = (value * 16777619) & 0xFFFFFFFF
    return f"{value:08x}"


def ensure_sync_columns(service):
    metadata = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties").execute()
    target = next((s["properties"] for s in metadata.get("sheets", []) if s["properties"].get("sheetId") == SHEET_ID), None)
    if not target:
        raise RuntimeError("Không tìm thấy tab Lịch công tác.")
    requests = []
    if target.get("gridProperties", {}).get("columnCount", 0) < 11:
        requests.append({"updateSheetProperties": {"properties": {"sheetId": SHEET_ID, "gridProperties": {"columnCount": 11}}, "fields": "gridProperties.columnCount"}})
    requests.extend([
        {"updateCells": {"range": {"sheetId": SHEET_ID, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 9, "endColumnIndex": 11}, "rows": [{"values": [{"userEnteredValue": {"stringValue": "WEB_TASK_IDS"}}, {"userEnteredValue": {"stringValue": "WEB_SYNC_HASH"}}]}], "fields": "userEnteredValue"}},
        {"updateDimensionProperties": {"range": {"sheetId": SHEET_ID, "dimension": "COLUMNS", "startIndex": 9, "endIndex": 11}, "properties": {"hiddenByUser": True}, "fields": "hiddenByUser"}},
    ])
    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": requests}).execute()


def pull_from_sheet(service, start_date, end_date):
    created = updated = 0
    touched = set()
    today = timezone.localdate()
    with suppress_sheet_queue():
        for offset, row in enumerate(_rows(service), start=2):
            work_date = _parse_date(_cell(row, 1))
            employee_id = _cell(row, 7)
            email = EMPLOYEE_EMAILS.get(employee_id)
            if not email or not work_date or not (start_date <= work_date <= end_date):
                continue
            executor = UserProfile.objects.filter(email=email, employment_status="ACTIVE").first()
            if not executor:
                continue
            parsed = parse_sheet_tasks(_cell(row, 4))
            notes = assessment_notes(_cell(row, 5), len(parsed))
            leader_notes = assessment_notes(_cell(row, 6), len(parsed))
            ids = _task_uids(_cell(row, 9))
            for index, parsed_task in enumerate(parsed, 1):
                sync_uid = ids[index - 1] if index <= len(ids) and ids[index - 1] else deterministic_sheet_uid(offset, index)
                item = WorkItem.objects.filter(sync_uid=sync_uid).first()
                if not item:
                    item = WorkItem.objects.filter(source_sheet_row=offset, source_task_index=index).first()
                note = notes[index - 1] if index <= len(notes) else ""
                task_status = status_from_note(note, work_date > today)
                leader_note = leader_notes[index - 1] if index <= len(leader_notes) else ""
                if leader_note and leader_note.strip().lower() not in {"chưa đánh giá", "chua danh gia"}:
                    task_status = WorkItem.STATUS_REVIEWED
                custom_note = "" if note.strip().lower() in {"cần làm", "đang thực hiện", "hoàn thành", "đã hoàn thành", "xong"} else note
                is_training = email == "liennt@fermat.edu.vn" and "tập huấn" in parsed_task.title.lower()
                if item:
                    item.executor = executor
                    item.title = parsed_task.title[:1000]
                    item.progress_note = custom_note[:1000]
                    item.work_date = work_date
                    item.start_time = parsed_task.start_time
                    item.end_time = training_end(parsed_task.start_time) if is_training else item.end_time
                    item.status = task_status
                    item.daily_order = index
                    item.source_sheet_row = offset
                    item.source_task_index = index
                    item.source_record_id = _cell(row, 8)
                    item.sync_uid = sync_uid
                    item.save()
                    updated += 1
                else:
                    item = WorkItem.objects.create(
                        creator=executor, executor=executor, title=parsed_task.title[:1000],
                        description="Nhập từ Lịch công tác FT 2026 mới.", progress_note=custom_note[:1000],
                        work_date=work_date, start_time=parsed_task.start_time,
                        end_time=training_end(parsed_task.start_time) if is_training else None,
                        status=task_status, priority="medium", label="Tập huấn" if is_training else "Công việc",
                        daily_order=index, source_sheet_row=offset, source_task_index=index,
                        source_record_id=_cell(row, 8), sync_uid=sync_uid,
                    )
                    created += 1
                touched.add((email, work_date))
    return {"created": created, "updated": updated, "groups": touched}


def _find_row(rows, email, work_date, items):
    employee_id = EMAIL_EMPLOYEES.get(email, "")
    for index, row in enumerate(rows, start=2):
        if _parse_date(_cell(row, 1)) == work_date and employee_id and _cell(row, 7) == employee_id:
            return index, row
    source_rows = {item.source_sheet_row for item in items if item.source_sheet_row}
    if len(source_rows) == 1:
        number = source_rows.pop()
        if 2 <= number <= len(rows) + 1:
            return number, rows[number - 2]
    return None, None


def push_groups_to_sheet(service, groups, force=False):
    rows = _rows(service)
    updates = []
    conflicts = []
    synced = []
    next_row = max((i for i, row in enumerate(rows, start=2) if any(_cell(row, c) for c in range(min(9, len(row))))), default=2) + 1
    for email, work_date in sorted(set(groups), key=lambda value: (value[1], value[0])):
        items = list(WorkItem.objects.filter(executor_id=email, work_date=work_date).order_by("daily_order", "start_time", "created_at", "pk"))
        row_number, current = _find_row(rows, email, work_date, items)
        if row_number is None:
            if not items:
                continue
            row_number, current = next_row, []
            next_row += 1
        live_values = (_cell(current, 4), _cell(current, 5), _cell(current, 6), _cell(current, 9))
        live_hash = _row_hash(*live_values)
        stored_hash = _cell(current, 10)
        if current and (not stored_hash or stored_hash != live_hash) and not force:
            conflicts.append({"email": email, "date": work_date.isoformat(), "row": row_number})
            continue
        content, self_notes, leader_notes, task_ids = _group_values(items) if items else ("", "", "", "")
        new_hash = _row_hash(content, self_notes, leader_notes, task_ids)
        updates.extend([
            {"range": f"'{SHEET_NAME}'!E{row_number}:G{row_number}", "values": [[content, self_notes, leader_notes]]},
            {"range": f"'{SHEET_NAME}'!J{row_number}:K{row_number}", "values": [[task_ids, new_hash]]},
        ])
        if not current:
            profile = UserProfile.objects.filter(email=email).first()
            iso_week = work_date.isocalendar().week
            record_id = f"REC-WEB-{uuid.uuid4().hex[:12].upper()}"
            updates.append({"range": f"'{SHEET_NAME}'!A{row_number}:D{row_number}", "values": [[WEEKDAYS[work_date.weekday()], work_date.strftime("%d/%m/%Y"), iso_week, profile.name if profile else email]]})
            updates.append({"range": f"'{SHEET_NAME}'!H{row_number}:I{row_number}", "values": [[EMAIL_EMPLOYEES.get(email, ""), record_id]]})
        synced.append((email, work_date, row_number, new_hash, items))
    if updates:
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={"valueInputOption": "USER_ENTERED", "data": updates},
        ).execute()
    with suppress_sheet_queue():
        for email, work_date, row_number, sync_hash, items in synced:
            for index, item in enumerate(items, 1):
                WorkItem.objects.filter(pk=item.pk).update(
                    daily_order=index, source_sheet_row=row_number, source_task_index=index, source_sync_hash=sync_hash
                )
    return {"groups": len(synced), "tasks": sum(len(x[4]) for x in synced), "conflicts": conflicts}


@contextmanager
def sync_lease(seconds=300):
    now = timezone.now()
    with transaction.atomic():
        lease, _ = WorkScheduleSheetSyncLease.objects.select_for_update().get_or_create(key="ft-work-schedule")
        if lease.locked_until and lease.locked_until > now:
            yield False
            return
        lease.locked_until = now + timedelta(seconds=seconds)
        lease.save(update_fields=["locked_until"])
    try:
        yield True
    finally:
        WorkScheduleSheetSyncLease.objects.filter(key="ft-work-schedule").update(locked_until=None)


def sync_to_sheet(google_token=None, force=False):
    with sync_lease() as acquired:
        if not acquired:
            return {"busy": True, "message": "Một lượt đồng bộ khác đang chạy."}
        pending = list(WorkScheduleSheetChange.objects.filter(status=WorkScheduleSheetChange.STATUS_PENDING).order_by("created_at")[:1000])
        groups = {(row.executor_email, row.work_date) for row in pending}
        if not groups:
            return {"groups": 0, "tasks": 0, "conflicts": []}
        ids = [row.pk for row in pending]
        WorkScheduleSheetChange.objects.filter(pk__in=ids).update(status=WorkScheduleSheetChange.STATUS_PROCESSING)
        try:
            service = _service(google_token)
            ensure_sync_columns(service)
            result = push_groups_to_sheet(service, groups, force=force)
            conflict_groups = {(row["email"], datetime.fromisoformat(row["date"]).date()) for row in result["conflicts"]}
            for change in pending:
                is_conflict = (change.executor_email, change.work_date) in conflict_groups
                change.status = WorkScheduleSheetChange.STATUS_CONFLICT if is_conflict else WorkScheduleSheetChange.STATUS_DONE
                change.processed_at = timezone.now()
                change.attempts += 1
                change.last_error = "Sheet đã thay đổi sau lần đồng bộ trước." if is_conflict else ""
            WorkScheduleSheetChange.objects.bulk_update(pending, ["status", "processed_at", "attempts", "last_error"])
            return result
        except Exception as exc:
            WorkScheduleSheetChange.objects.filter(pk__in=ids).update(status=WorkScheduleSheetChange.STATUS_FAILED, last_error=str(exc), attempts=1)
            raise


def initial_two_way_sync(google_token=None):
    service = _service(google_token)
    ensure_sync_columns(service)
    today = timezone.localdate()
    start = today.replace(day=1)
    month_end = today.replace(day=monthrange(today.year, today.month)[1])
    end = month_end + timedelta(days=14)
    pulled = pull_from_sheet(service, start, end)
    groups = set(pulled["groups"])
    groups.update(WorkItem.objects.filter(work_date__range=(start, end)).values_list("executor_id", "work_date"))
    pushed = push_groups_to_sheet(service, groups, force=True)
    WorkScheduleSheetChange.objects.filter(executor_email__in=[g[0] for g in groups], work_date__range=(start, end), status__in=["pending", "failed", "conflict"]).update(status="done", processed_at=timezone.now(), last_error="")
    result = {"start": start.isoformat(), "end": end.isoformat(), "pulled": pulled, "pushed": pushed}
    result["pulled"]["groups"] = len(result["pulled"]["groups"])
    SystemConfig.objects.update_or_create(key="work_schedule_sheet_sync", defaults={"data": {"lastSuccessAt": timezone.now().isoformat(), **result}})
    return result


def sync_status():
    config = SystemConfig.objects.filter(key="work_schedule_sheet_sync").first()
    counts = {row["status"]: row["count"] for row in WorkScheduleSheetChange.objects.values("status").annotate(count=models.Count("id"))}
    return {"lastSync": config.data if config else {}, "queue": counts}
