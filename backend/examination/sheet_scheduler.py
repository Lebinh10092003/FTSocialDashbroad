import uuid

from django.utils import timezone

from .models import ExaminationSheet, LogNote
from .sync import (
    export_session_to_google_sheet,
    remote_sheet_fingerprint,
    output_sheet_export_preview,
    sheet_values_fingerprint,
    sync_single_sheet,
)


def sheet_is_in_automation_window(sheet, today=None):
    today = today or timezone.localdate()
    return (
        sheet.automation_enabled
        and (not sheet.automation_start_date or sheet.automation_start_date <= today)
        and (not sheet.automation_end_date or sheet.automation_end_date >= today)
    )


def record_sheet_log(sheet, content):
    LogNote.objects.create(
        key=f'session-{sheet.session_id}:sheet:{uuid.uuid4().hex}',
        entity_key=f'session-{sheet.session_id}',
        content=content,
        updated_by='Hệ thống FT Workspace',
        system=True,
    )


def output_sheet_has_unreviewed_changes(sheet, google_access_token=None):
    current = remote_sheet_fingerprint(sheet, google_access_token)
    empty = sheet_values_fingerprint([])
    if not sheet.last_content_fingerprint:
        return current != empty, current
    return current != sheet.last_content_fingerprint, current


def run_registration_imports(now=None):
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    rows = ExaminationSheet.objects.filter(stage='registration-source').order_by('session_id', 'id')
    summary = {'operation': 'registration-import', 'processed': 0, 'success': 0, 'failed': 0, 'skipped': 0}
    for sheet in rows:
        if not sheet_is_in_automation_window(sheet, local_now.date()):
            summary['skipped'] += 1
            continue
        summary['processed'] += 1
        timestamp = local_now.strftime('%d/%m/%Y %H:%M:%S')
        result = sync_single_sheet(sheet.url, timestamp, sheet.id, sheet.session_id, sheet_tab=sheet.sheet_tab)
        sheet.last_import_at = now
        sheet.status = 'success' if result.get('success') else 'failed'
        sheet.last_error = '' if result.get('success') else str(result.get('message') or 'Không thể nhập dữ liệu.')
        sheet.updated_at = now
        sheet.save(update_fields=['last_import_at', 'status', 'last_error', 'updated_at'])
        if result.get('success'):
            summary['success'] += 1
            record_sheet_log(sheet, f'Tự động nhập Sheet đầu vào: {result.get("created", 0)} hồ sơ mới, {result.get("updated", 0)} hồ sơ cập nhật.')
        else:
            summary['failed'] += 1
            record_sheet_log(sheet, f'Tự động nhập Sheet đầu vào thất bại: {sheet.last_error}')
    return summary


def run_output_exports(now=None):
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    rows = ExaminationSheet.objects.filter(stage='session-output').order_by('session_id', 'id')
    summary = {'operation': 'output-export', 'processed': 0, 'success': 0, 'failed': 0, 'blocked': 0, 'skipped': 0}
    for sheet in rows:
        if not sheet_is_in_automation_window(sheet, local_now.date()):
            summary['skipped'] += 1
            continue
        summary['processed'] += 1
        try:
            changed, _ = output_sheet_has_unreviewed_changes(sheet)
            if changed:
                sheet.pending_manual_import = True
                sheet.status = 'attention'
                sheet.last_error = 'Sheet tổng hợp có chỉnh sửa chưa được nhập vào hệ thống.'
                sheet.updated_at = now
                sheet.save(update_fields=['pending_manual_import', 'status', 'last_error', 'updated_at'])
                summary['blocked'] += 1
                record_sheet_log(sheet, 'Tạm dừng xuất tự động vì Sheet tổng hợp có chỉnh sửa đang chờ nhập thủ công.')
                continue
            preview = output_sheet_export_preview(sheet)
            if preview.get('appendedRows'):
                sheet.pending_manual_import = True
                sheet.status = 'attention'
                sheet.last_error = 'Số lượng thí sinh giữa hệ thống và Sheet đang lệch; chờ người quản lý chọn cách xử lý.'
                sheet.updated_at = now
                sheet.save(update_fields=['pending_manual_import', 'status', 'last_error', 'updated_at'])
                summary['blocked'] += 1
                record_sheet_log(sheet, 'Tạm dừng xuất tự động vì danh sách thí sinh giữa hệ thống và Sheet bị lệch.')
                continue
            result = export_session_to_google_sheet(sheet)
            sheet.last_export_at = now
            sheet.last_content_fingerprint = result.get('fingerprint', '')
            sheet.pending_manual_import = False
            sheet.status = 'success'
            sheet.last_error = ''
            sheet.updated_at = now
            sheet.save(update_fields=['last_export_at', 'last_content_fingerprint', 'pending_manual_import', 'status', 'last_error', 'updated_at'])
            summary['success'] += 1
            record_sheet_log(sheet, f'Tự động xuất {result.get("exported", 0)} hồ sơ sang Sheet tổng hợp.')
        except Exception as exc:
            sheet.status = 'failed'
            sheet.last_error = str(exc)
            sheet.updated_at = now
            sheet.save(update_fields=['status', 'last_error', 'updated_at'])
            summary['failed'] += 1
            record_sheet_log(sheet, f'Tự động xuất Sheet tổng hợp thất bại: {exc}')
    return summary
