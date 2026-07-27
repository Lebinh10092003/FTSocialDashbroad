"""Publish Examination database data to read-only Google Sheets workbooks."""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from typing import Iterable

from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id
from .models import ExamSession, ExaminationSheetPublication
from .sync import session_export_rows, sync_session_candidate_totals

SUMMARY_TAB = 'T\u1ed4NG QUAN K\u1ef2 THI'
PARTNERS_TAB = '\u0110\u1ed0I T\u00c1C'


def _normalise(value: object) -> str:
    return ''.join(
        character for character in unicodedata.normalize('NFD', str(value or '').lower())
        if unicodedata.category(character) != 'Mn'
    ).replace('\u0111', 'd')


def _parse_date(value: object) -> date | None:
    text = str(value or '').strip()
    if not text:
        return None
    for pattern in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def academic_year_for_date(value: date) -> str:
    """Academic year runs from September through July of the following year."""
    start_year = value.year if value.month >= 9 else value.year - 1
    return f'{start_year}-{start_year + 1}'


def session_academic_year(session: ExamSession) -> str:
    """Classify a session by its qualifying round, then earliest concrete round."""
    rounds = session.rounds or []
    qualifying = [
        item for item in rounds
        if isinstance(item, dict) and 'vong loai' in _normalise(item.get('name') or item.get('label'))
    ]
    for round_item in qualifying + [item for item in rounds if item not in qualifying]:
        if not isinstance(round_item, dict):
            continue
        parsed = _parse_date(round_item.get('date'))
        if parsed:
            return academic_year_for_date(parsed)
    for value in (session.national_date, session.international_date):
        parsed = _parse_date(value)
        if parsed:
            return academic_year_for_date(parsed)
    return ''


def _safe_tab_name(value: str) -> str:
    text = re.sub(r'[\\/:?*\[\]]', '-', str(value or '')).strip()
    return (text or 'D\u1eef li\u1ec7u').replace("'", '\u2019')[:100]


def _range_title(title: str) -> str:
    return "'" + title.replace("'", "''") + "'"


def _metadata(service, spreadsheet_id: str) -> dict[str, int]:
    payload = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields='sheets(properties(sheetId,title))',
    ).execute()
    return {
        str(sheet['properties']['title']): int(sheet['properties']['sheetId'])
        for sheet in payload.get('sheets', [])
        if sheet.get('properties', {}).get('title')
    }


def _ensure_tab(service, spreadsheet_id: str, title: str) -> int:
    sheets = _metadata(service, spreadsheet_id)
    if title not in sheets:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={'requests': [{'addSheet': {'properties': {'title': title}}}]},
        ).execute()
        sheets = _metadata(service, spreadsheet_id)
    return sheets[title]


def _write_tab(service, spreadsheet_id: str, title: str, values: list[list[object]], header_rows: int = 1) -> None:
    sheet_id = _ensure_tab(service, spreadsheet_id, title)
    range_title = _range_title(title)
    service.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=range_title, body={}).execute()
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f'{range_title}!A1',
        valueInputOption='RAW',
        body={'values': values or [['Ch\u01b0a c\u00f3 d\u1eef li\u1ec7u']]},
    ).execute()
    column_count = max((len(row) for row in values), default=1)
    requests = [
        {'updateSheetProperties': {'properties': {'sheetId': sheet_id, 'gridProperties': {'frozenRowCount': header_rows}}, 'fields': 'gridProperties.frozenRowCount'}},
        {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': header_rows, 'startColumnIndex': 0, 'endColumnIndex': column_count}, 'cell': {'userEnteredFormat': {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.89, 'green': 0.94, 'blue': 1.0}}}, 'fields': 'userEnteredFormat(textFormat,backgroundColor)'}},
        {'setBasicFilter': {'filter': {'range': {'sheetId': sheet_id, 'startRowIndex': max(header_rows - 1, 0), 'startColumnIndex': 0, 'endColumnIndex': column_count}}}},
    ]
    service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': requests}).execute()


def session_tab_name(session: ExamSession) -> str:
    return _safe_tab_name(f'TS — {session.code} — {session.time or session.name}')


def summary_rows(sessions: Iterable[ExamSession]) -> list[list[object]]:
    rows: list[list[object]] = [[
        'STT', 'M\u00e3 k\u1ef3 t\u1ed5 ch\u1ee9c', 'T\u00ean k\u1ef3 t\u1ed5 ch\u1ee9c', 'Cu\u1ed9c thi', 'BTC qu\u1ed1c t\u1ebf',
        'Th\u1eddi gian', 'Giai \u0111o\u1ea1n hi\u1ec7n t\u1ea1i', 'S\u1ed1 th\u00ed sinh', 'C\u1eadp nh\u1eadt l\u1ea7n cu\u1ed1i', 'T\u00ean tab th\u00ed sinh',
    ]]
    for index, session in enumerate(sessions, start=1):
        rows.append([
            index, session.id, session.name, session.parent, session.organizer, session.time,
            session.phase, session.candidates_count, timezone.localtime(session.updated_at).strftime('%d/%m/%Y %H:%M'),
            session_tab_name(session),
        ])
    return rows


def partner_rows(partners: Iterable[dict]) -> list[list[object]]:
    rows: list[list[object]] = [[
        'STT', 'T\u1ec9nh / Th\u00e0nh ph\u1ed1', 'Ph\u01b0\u1eddng / X\u00e3', 'Tr\u01b0\u1eddng', 'C\u1ea5p h\u1ecdc', '\u0110\u1ea1i di\u1ec7n',
        'S\u0110T li\u00ean l\u1ea1c', 'Email li\u00ean l\u1ea1c', 'C\u00e1c cu\u1ed9c thi \u0111\u00e3 t\u1eebng tham gia', 'T\u1ed5ng l\u01b0\u1ee3t th\u00ed sinh \u0111\u00e3 c\u1ed9ng t\u00e1c',
    ]]
    for index, partner in enumerate(partners, start=1):
        counts = partner.get('studentCounts') or []
        total = sum(max(0, int(item.get('count') or 0)) for item in counts if isinstance(item, dict))
        rows.append([
            index, partner.get('province', ''), partner.get('ward', ''), partner.get('school', ''),
            partner.get('level', ''), partner.get('representative', ''), partner.get('phone', ''), partner.get('email', ''),
            ', '.join(partner.get('contests') or []), total,
        ])
    return rows


def publication_payload(publication: ExaminationSheetPublication) -> dict:
    return {
        'id': publication.id,
        'academicYear': publication.academic_year,
        'spreadsheetUrl': publication.spreadsheet_url,
        'enabled': publication.enabled,
        'lastSyncedAt': publication.last_synced_at.isoformat() if publication.last_synced_at else None,
        'lastStatus': publication.last_status,
        'lastError': publication.last_error,
        'lastSummary': publication.last_summary or {},
        'updatedAt': publication.updated_at.isoformat(),
    }


def sync_publication(publication: ExaminationSheetPublication, partners: Iterable[dict], session_ids: Iterable[str] | None = None, include_summary: bool = True, include_partners: bool = True) -> dict:
    partners = list(partners)
    spreadsheet_id = extract_spreadsheet_id(publication.spreadsheet_url)
    if not spreadsheet_id:
        raise ValueError('H\u00e3y nh\u1eadp \u0111\u01b0\u1eddng d\u1eabn ho\u1eb7c ID Google Sheet trung t\u00e2m h\u1ee3p l\u1ec7.')
    config = SystemConfig.objects.filter(key='main').first()
    service = build_sheets_service('', (config.data if config else {}) or {})
    sync_session_candidate_totals()
    sessions = [session for session in ExamSession.objects.all().order_by('sort_key') if session_academic_year(session) == publication.academic_year]
    selected_ids = {str(item) for item in session_ids or [] if str(item)}
    target_sessions = [session for session in sessions if not selected_ids or session.id in selected_ids]
    if include_summary:
        _write_tab(service, spreadsheet_id, SUMMARY_TAB, summary_rows(sessions))
    if include_partners:
        _write_tab(service, spreadsheet_id, PARTNERS_TAB, partner_rows(partners))
    for session in target_sessions:
        _write_tab(service, spreadsheet_id, session_tab_name(session), session_export_rows(session.id), header_rows=2)
    result = {
        'academicYear': publication.academic_year,
        'sessions': len(target_sessions),
        'partners': len(partners) if include_partners else 0,
        'summary': bool(include_summary),
        'spreadsheetId': spreadsheet_id,
        'tabs': [session_tab_name(session) for session in target_sessions],
    }
    publication.last_synced_at = timezone.now()
    publication.last_status = 'success'
    publication.last_error = ''
    publication.last_summary = result
    publication.save(update_fields=['last_synced_at', 'last_status', 'last_error', 'last_summary', 'updated_at'])
    return result