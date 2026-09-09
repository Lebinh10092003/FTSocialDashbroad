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
    "EMP-E6557326": "thuanld@fermat.edu.vn",
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
SHEET_STAFF_EMAILS = {
    "thuận": "thuanld@fermat.edu.vn",
}
WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"]
INCREMENTAL_SYNC_LEASE_SECONDS = 300
TWO_WAY_SYNC_LEASE_SECONDS = 1800


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
        # Open-ended so rows appended after the original 6109-row grid are also
        # part of future full-sync scans.
        range=f"'{SHEET_NAME}'!A2:K",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    return result.get("values", [])


def _cell(row, index):
    return str(row[index] if index < len(row) else "").strip()


def _row_employee_email(row):
    email = EMPLOYEE_EMAILS.get(_cell(row, 7))
    if email:
        return email
    staff_name = re.sub(r"^\s*\d+\s*[.)-]?\s*", "", _cell(row, 3)).strip().casefold()
    return SHEET_STAFF_EMAILS.get(staff_name)


def _parse_date(value):
    raw = str(value or "").strip()
    for pattern in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, pattern).date()
        except (TypeError, ValueError):
            pass
    # Apps Script getValues() serializes a Sheet Date as an ISO UTC instant.
    # Convert it back through Django's local timezone before taking the date;
    # e.g. 09/09 in Vietnam arrives as 2026-09-08T17:00:00.000Z.
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if timezone.is_aware(parsed):
            parsed = timezone.localtime(parsed)
        return parsed.date()
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


def _duplicate_title_key(value):
    """Treat visually identical task titles as the same task within one day."""
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _unique_sheet_tasks(tasks):
    """Remove repeated numbered lines inside one Sheet cell.

    Prefer the occurrence carrying a start time, while retaining the first visual
    position. This targets the duplicated-line source without merging unrelated
    records that happen to share a title elsewhere in the application.
    """
    unique = []
    positions = {}
    for task in tasks:
        key = _duplicate_title_key(task.title)
        if not key:
            continue
        if key not in positions:
            positions[key] = len(unique)
            unique.append(task)
        elif task.start_time and not unique[positions[key]].start_time:
            unique[positions[key]] = task
    return unique


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


def ensure_sheet_row_capacity(service, required_row):
    """Grow the tab before values.batchUpdate targets a row beyond its grid."""
    metadata = service.spreadsheets().get(
        spreadsheetId=SPREADSHEET_ID,
        fields="sheets.properties(sheetId,gridProperties(rowCount))",
    ).execute()
    target = next(
        (sheet.get("properties", {}) for sheet in metadata.get("sheets", [])
         if sheet.get("properties", {}).get("sheetId") == SHEET_ID),
        None,
    )
    if not target:
        raise RuntimeError("Không tìm thấy tab Lịch công tác.")
    current_rows = int(target.get("gridProperties", {}).get("rowCount", 0))
    if required_row <= current_rows:
        return current_rows
    rows_to_add = max(required_row - current_rows, 500)
    service.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [{
            "appendDimension": {
                "sheetId": SHEET_ID,
                "dimension": "ROWS",
                "length": rows_to_add,
            }
        }]},
    ).execute()
    return current_rows + rows_to_add


def _ingest_row(offset, row, today):
    """Parse one sheet row (A:K, same shape as `_rows()` yields) and upsert its WorkItems.

    Shared by `pull_from_sheet` (bulk, one row per iteration) and the realtime
    webhook (exactly one row, no date-range filter). Caller is responsible for
    wrapping this in `suppress_sheet_queue()`.
    """
    created = updated = deleted = 0
    touched = set()
    work_date = _parse_date(_cell(row, 1))
    email = _row_employee_email(row)
    if not email or not work_date:
        return created, updated, deleted, touched
    executor = UserProfile.objects.filter(email=email, employment_status="ACTIVE").first()
    if not executor:
        return created, updated, deleted, touched
    source_items = list(WorkItem.objects.filter(source_sheet_row=offset))
    touched.add((email, work_date))
    touched.update((item.executor_id, item.work_date) for item in source_items)
    parsed = _unique_sheet_tasks(parse_sheet_tasks(_cell(row, 4)))
    notes = assessment_notes(_cell(row, 5), len(parsed))
    leader_notes = assessment_notes(_cell(row, 6), len(parsed))
    ids = _task_uids(_cell(row, 9))
    retained_ids = set()
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
        retained_ids.add(item.pk)
    stale_items = [item for item in source_items if item.pk not in retained_ids]
    if stale_items:
        from .training_sync import delete_training_for_work_item

        for item in stale_items:
            delete_training_for_work_item(item)
            item.delete()
            deleted += 1
    return created, updated, deleted, touched


def pull_from_sheet(service, start_date, end_date):
    created = updated = deleted = 0
    touched = set()
    today = timezone.localdate()
    with suppress_sheet_queue():
        for offset, row in enumerate(_rows(service), start=2):
            work_date = _parse_date(_cell(row, 1))
            if not work_date or not (start_date <= work_date <= end_date):
                continue
            row_created, row_updated, row_deleted, row_touched = _ingest_row(offset, row, today)
            created += row_created
            updated += row_updated
            deleted += row_deleted
            touched |= row_touched
    return {"created": created, "updated": updated, "deleted": deleted, "groups": touched}


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


_TIME_LINE_RE = re.compile(r'^\d+\.\s+\d{1,2}:\d{2}')


def _build_content_format_runs(content):
    """Return textFormatRuns for bold+italic on time-prefixed task lines."""
    lines = content.split('\n')
    runs = []
    offset = 0
    prev_bold = None
    for line in lines:
        is_bold = bool(_TIME_LINE_RE.match(line))
        if is_bold != prev_bold:
            fmt = {'bold': True, 'italic': True, 'foregroundColorStyle': {'rgbColor': {'red': 0.0, 'green': 0.13, 'blue': 0.25}}} if is_bold else {}
            runs.append({'startIndex': offset, 'format': fmt})
            prev_bold = is_bold
        offset += len(line) + 1  # +1 for newline character
    return runs


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
        ensure_sheet_row_capacity(service, max(row[2] for row in synced))
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={"valueInputOption": "USER_ENTERED", "data": updates},
        ).execute()
    # Apply bold+italic formatting to time-prefixed task lines in column E
    format_requests = []
    for email, work_date, row_number, sync_hash, items in synced:
        content, _, _, _ = _group_values(items) if items else ("", "", "", "")
        runs = _build_content_format_runs(content)
        if runs:
            format_requests.append({
                'updateCells': {
                    'range': {
                        'sheetId': SHEET_ID,
                        'startRowIndex': row_number - 1,
                        'endRowIndex': row_number,
                        'startColumnIndex': 4,  # column E (0-indexed)
                        'endColumnIndex': 5,
                    },
                    'rows': [{'values': [{'textFormatRuns': [
                        {'startIndex': run['startIndex'], 'format': run['format']}
                        for run in runs
                    ]}]}],
                    'fields': 'textFormatRuns',
                }
            })
    if format_requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={'requests': format_requests},
        ).execute()
    with suppress_sheet_queue():
        for email, work_date, row_number, sync_hash, items in synced:
            for index, item in enumerate(items, 1):
                WorkItem.objects.filter(pk=item.pk).update(
                    daily_order=index, source_sheet_row=row_number, source_task_index=index, source_sync_hash=sync_hash
                )
    return {"groups": len(synced), "tasks": sum(len(x[4]) for x in synced), "conflicts": conflicts}


@contextmanager
def sync_lease(seconds=INCREMENTAL_SYNC_LEASE_SECONDS):
    """Acquire the shared Sheet-sync lease.

    ``locked_until`` doubles as a lease generation token. The conditional cleanup
    prevents an expired worker from clearing a lease that a newer worker acquired.
    A dead worker therefore blocks only until its timeout, never indefinitely.
    """
    now = timezone.now()
    acquired_until = now + timedelta(seconds=seconds)
    with transaction.atomic():
        lease, _ = WorkScheduleSheetSyncLease.objects.select_for_update().get_or_create(key="ft-work-schedule")
        if lease.locked_until and lease.locked_until > now:
            yield False
            return
        lease.locked_until = acquired_until
        lease.save(update_fields=["locked_until"])
    try:
        yield True
    finally:
        # Only the owner of this exact lease generation may release it. If this
        # worker outlived its timeout and another worker took over, leave the new
        # owner's lease untouched.
        WorkScheduleSheetSyncLease.objects.filter(
            key="ft-work-schedule", locked_until=acquired_until
        ).update(locked_until=None)


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


def _two_way_sync(google_token, start, end):
    service = _service(google_token)
    ensure_sync_columns(service)
    pulled = pull_from_sheet(service, start, end)
    groups = set(pulled["groups"])
    groups.update(WorkItem.objects.filter(work_date__range=(start, end)).values_list("executor_id", "work_date"))
    pushed = push_groups_to_sheet(service, groups, force=True)
    WorkScheduleSheetChange.objects.filter(executor_email__in=[g[0] for g in groups], work_date__range=(start, end), status__in=["pending", "failed", "conflict"]).update(status="done", processed_at=timezone.now(), last_error="")
    result = {"start": start.isoformat(), "end": end.isoformat(), "pulled": pulled, "pushed": pushed}
    result["pulled"]["groups"] = len(result["pulled"]["groups"])
    SystemConfig.objects.update_or_create(key="work_schedule_sheet_sync", defaults={"data": {"lastSuccessAt": timezone.now().isoformat(), **result}})
    return result


def initial_two_way_sync(google_token=None):
    today = timezone.localdate()
    start = today.replace(day=1)
    month_end = today.replace(day=monthrange(today.year, today.month)[1])
    end = month_end + timedelta(days=14)
    with sync_lease(seconds=TWO_WAY_SYNC_LEASE_SECONDS) as acquired:
        if not acquired:
            return {"busy": True, "message": "Một lượt đồng bộ khác đang chạy."}
        return _two_way_sync(google_token, start, end)


def full_two_way_sync(google_token=None):
    """Re-read the complete configured Sheet range and reconcile all dated rows."""
    with sync_lease(seconds=TWO_WAY_SYNC_LEASE_SECONDS) as acquired:
        if not acquired:
            return {"busy": True, "message": "Một lượt đồng bộ khác đang chạy."}
        return _two_way_sync(google_token, datetime(1900, 1, 1).date(), datetime(9999, 12, 31).date())


def sync_status():
    config = SystemConfig.objects.filter(key="work_schedule_sheet_sync").first()
    counts = {row["status"]: row["count"] for row in WorkScheduleSheetChange.objects.values("status").annotate(count=models.Count("id"))}
    return {"lastSync": config.data if config else {}, "queue": counts}
