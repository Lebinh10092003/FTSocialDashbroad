import io
import csv
import re
import requests
import datetime
import uuid
import unicodedata
from django.utils import timezone
from .models import Candidate, CandidateParticipation, RoundResult, ExamSession, Competition, ExaminationSheet
from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id

DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing'

def clean_txt(value):
    if value is None:
        return ''
    return str(value).strip()

def normalise_str(value):
    text = clean_txt(value).casefold().replace(chr(273), 'd')
    text = unicodedata.normalize('NFD', text)
    text = ''.join(char for char in text if not unicodedata.combining(char))
    return re.sub(r'[^a-z0-9]+', '', text)

def get_contest_codes(value):
    val = clean_txt(value)
    if not val:
        return []
    parts = re.split(r'[,;]', val)
    return [p.strip().upper() for p in parts if p.strip()]

def merge_contest_codes(*values):
    codes = []
    for v in values:
        codes.extend(get_contest_codes(v))
    # Remove duplicates preserving order
    seen = set()
    result = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return ', '.join(result)

def same_candidate(a, b):
    # Exact government ID is strongest identity key.
    identity_a = normalise_str(a.get('identity'))
    identity_b = normalise_str(b.get('identity'))
    if identity_a and identity_b:
        return identity_a == identity_b

    name_a, name_b = normalise_str(a.get('name')), normalise_str(b.get('name'))
    if not name_a or name_a != name_b:
        return False

    # Email plus the same name is safe enough to link a returning candidate.
    email_a, email_b = normalise_str(a.get('email')), normalise_str(b.get('email'))
    if email_a and email_b and email_a == email_b:
        return True

    # When there is no ID/email, require the three stable fields; never match by name alone.
    dob_a, dob_b = normalise_str(a.get('birth_date')), normalise_str(b.get('birth_date'))
    school_a, school_b = normalise_str(a.get('school')), normalise_str(b.get('school'))
    return bool(dob_a and dob_b and school_a and school_b and dob_a == dob_b and school_a == school_b)

def next_code(existing_codes_set, offset):
    yr = datetime.datetime.now().strftime('%y')
    seq = offset + 1
    candidate = f"FT{yr}-{seq:04d}"
    while candidate in existing_codes_set:
        seq += 1
        candidate = f"FT{yr}-{seq:04d}"
    return candidate

def parse_dob(raw):
    cleaned = clean_txt(raw).replace(' ', '')
    cleaned = re.sub(r'[^0-9/\-.]', '', cleaned)
    parts = re.split(r'[/\-.]', cleaned)
    if len(parts) != 3:
        return ''
        
    day = ''
    month = ''
    year = ''
    
    if len(parts[2]) == 4:
        day = parts[0].zfill(2)
        month = parts[1].zfill(2)
        year = parts[2]
    elif len(parts[0]) == 4:
        year = parts[0]
        month = parts[1].zfill(2)
        day = parts[2].zfill(2)
    else:
        return ''
        
    try:
        d, m, y = int(day), int(month), int(year)
        if d < 1 or d > 31 or m < 1 or m > 12 or y < 1990 or y > 2025:
            return ''
        return f"{year}-{month}-{day}"
    except ValueError:
        return ''

def resolve_column_indices(header):
    n = lambda h: normalise_str(h)
    idx = {}
    
    for i, h in enumerate(header):
        nh = n(h)
        if 'timestamp' not in idx and ('thoigian' in nh or 'timestamp' in nh):
            idx['timestamp'] = i
        elif 'stt' not in idx and (nh == 'stt' or nh.startswith('sott') or nh.startswith('sôtt')):
            idx['stt'] = i
        elif 'name' not in idx and ('hovantenthisinh' in nh or 'hovaten' in nh or 'thisinh' in nh or 'ten' in nh):
            idx['name'] = i
        elif 'amount' not in idx and ('tien' in nh or 'sotiendanop' in nh or 'lephi' in nh):
            idx['amount'] = i
        elif 'invoice' not in idx and ('hoadon' in nh or 'hoadien' in nh):
            idx['invoice'] = i
        elif 'contests' not in idx and ('kythidangky' in nh or 'dangkythi' in nh or 'monthi' in nh or 'dangthi' in nh or 'contest' in nh or 'kythi' in nh):
            idx['contests'] = i
        elif 'className' not in idx and ('hocsinhlop' in nh or ('lop' in nh and 'khoi' not in nh)):
            idx['className'] = i
        elif 'dob' not in idx and ('ngaythangnamsinh' in nh or 'namsinh' in nh or 'ngaysinh' in nh or 'dob' in nh or 'birthday' in nh):
            idx['dob'] = i
        elif 'grade' not in idx and ('khoithi' in nh or 'khoi' in nh):
            idx['grade'] = i
        elif 'school' not in idx and ('truong' in nh and 'email' not in nh):
            idx['school'] = i
        elif 'cccd' not in idx and ('cccd' in nh or 'canchuan' in nh or 'dinhdanh' in nh or 'identity' in nh or 'cmnd' in nh):
            idx['cccd'] = i
        elif 'streetAddress' not in idx and ('diachinh' in nh or 'diachinharieng' in nh or ('diachi' in nh and len(nh) < 15)):
            idx['streetAddress'] = i
        elif 'ward' not in idx and ('xa' in nh or 'phuong' in nh):
            idx['ward'] = i
        elif 'city' not in idx and ('tinhthanhpho' in nh or 'tinh' in nh or 'thanhpho' in nh or 'city' in nh):
            idx['city'] = i
        elif 'fullAddress' not in idx and (nh == 'diachi' or 'diachidaydu' in nh or 'address' in nh):
            idx['fullAddress'] = i
        elif 'email' not in idx and 'email' in nh:
            idx['email'] = i
        elif 'emailStatus' not in idx and ('tinhtranggui' in nh or 'guiemail' in nh):
            idx['emailStatus'] = i
        elif 'phone' not in idx and ('dienthoai' in nh or 'sdt' in nh or 'phone' in nh or 'giamho' in nh):
            idx['phone'] = i
        elif 'paymentStatus' not in idx and ('chuyenkhoan' in nh or 'noplephi' in nh or 'tinhtrangnop' in nh or 'thanhtoan' in nh):
            idx['paymentStatus'] = i
        elif 'note' not in idx and ('ghichu' in nh or 'suco' in nh or 'note' in nh):
            idx['note'] = i

    is_am_format = len(header) <= 15 or idx.get('contests') == 12
    
    if is_am_format:
        if 'timestamp' not in idx: idx['timestamp'] = 0
        if 'name' not in idx: idx['name'] = 1
        if 'dob' not in idx: idx['dob'] = 2
        if 'className' not in idx: idx['className'] = 3
        if 'school' not in idx: idx['school'] = 4
        if 'city' not in idx: idx['city'] = 5
        if 'phone' not in idx: idx['phone'] = 6
        if 'email' not in idx: idx['email'] = 7
        if 'cccd' not in idx: idx['cccd'] = 8
        if 'fullAddress' not in idx: idx['fullAddress'] = 9
        if 'paymentStatus' not in idx: idx['paymentStatus'] = 10
        if 'note' not in idx: idx['note'] = 11
        if 'contests' not in idx: idx['contests'] = 12
    else:
        if 'timestamp' not in idx: idx['timestamp'] = 0
        if 'stt' not in idx: idx['stt'] = 1
        if 'name' not in idx: idx['name'] = 2
        if 'amount' not in idx: idx['amount'] = 3
        if 'invoice' not in idx: idx['invoice'] = 4
        if 'contests' not in idx: idx['contests'] = 5
        if 'className' not in idx: idx['className'] = 6
        if 'dob' not in idx: idx['dob'] = 7
        if 'grade' not in idx: idx['grade'] = 8
        if 'school' not in idx: idx['school'] = 9
        if 'cccd' not in idx: idx['cccd'] = 10
        if 'streetAddress' not in idx: idx['streetAddress'] = 11
        if 'ward' not in idx: idx['ward'] = 12
        if 'city' not in idx: idx['city'] = 13
        if 'fullAddress' not in idx: idx['fullAddress'] = 14
        if 'email' not in idx: idx['email'] = 15
        if 'emailStatus' not in idx: idx['emailStatus'] = 16
        if 'phone' not in idx: idx['phone'] = 17
        if 'paymentStatus' not in idx: idx['paymentStatus'] = 18
        if 'note' not in idx: idx['note'] = 19
        
    return idx

ROUND_HISTORY_FIELD_MAP = {
    'sbd': 'sbd',
    'date': 'exam_date',
    'time': 'time_slot',
    'mode': 'mode',
    'location': 'location',
    'link': 'link',
    'account': 'account',
    'password': 'password',
    'attendance': 'attendance',
    'score': 'score',
    'scoreRate': 'score_rate',
    'rank': 'rank',
    'result': 'result',
    'note': 'note',
}


def merged_headers(grid, header_index):
    group_row = grid[header_index - 1] if header_index > 0 else []
    current_group = ''
    headers = []
    for index, label in enumerate(grid[header_index]):
        group = clean_txt(group_row[index]) if index < len(group_row) else ''
        if group:
            current_group = group
        title = clean_txt(label)
        headers.append(f"{current_group}: {title}" if current_group and title else title)
    return headers


def history_from_sheet_row(headers, row):
    field_aliases = {
        'eligibility': ['dieukienduthi', 'dieukien'],
        'sbd': ['sobaodanh', 'sbd'],
        'date': ['ngaythi'],
        'time': ['giocathi', 'giothi'],
        'mode': ['hinhthucthi'],
        'location': ['diadiemphongthi', 'diadiemthi'],
        'link': ['linkthi'],
        'account': ['taikhoanmatruycap', 'taikhoan'],
        'password': ['matkhau', 'password'],
        'attendance': ['trangthaiduthi', 'trangthaithamgia'],
        'scoreRate': ['tylediem'],
        'score': ['diem'],
        'rank': ['xephang'],
        'result': ['ketquagiaithuong', 'ketqua'],
        'note': ['ghichusuco', 'ghichu'],
    }
    rounds = []
    for number in (1, 2, 3):
        prefix = f"vong{number}"
        values = {}
        for index, header in enumerate(headers):
            if index >= len(row):
                continue
            normalized = normalise_str(header)
            if not normalized.startswith(prefix):
                continue
            value = clean_txt(row[index])
            if not value:
                continue
            for key, aliases in field_aliases.items():
                if any(alias in normalized for alias in aliases):
                    values[key] = value
                    break
        if values:
            values['round'] = 'V' + chr(242) + 'ng ' + str(number)
            rounds.append(values)
    return rounds


def upsert_participation_history(candidate, session_id, history, source=''):
    if not session_id:
        return None
    session = ExamSession.objects.filter(id=session_id).first()
    if not session:
        return None
    participation, _ = CandidateParticipation.objects.get_or_create(
        candidate=candidate,
        session=session,
        defaults={'source': source or ''},
    )
    if source and participation.source != source:
        participation.source = source
        participation.save(update_fields=['source', 'updated_at'])
    for item in history or []:
        if not isinstance(item, dict):
            continue
        round_name = clean_txt(item.get('round'))
        if not round_name:
            continue
        values = {
            model_field: clean_txt(item.get(payload_field))
            for payload_field, model_field in ROUND_HISTORY_FIELD_MAP.items()
        }
        values['raw_data'] = {str(key): value for key, value in item.items() if value not in (None, '')}
        existing_result = RoundResult.objects.filter(participation=participation, round_name=round_name).first()
        if existing_result:
            for model_field in ROUND_HISTORY_FIELD_MAP.values():
                if not values.get(model_field):
                    values[model_field] = getattr(existing_result, model_field)
        RoundResult.objects.update_or_create(
            participation=participation,
            round_name=round_name,
            defaults=values,
        )
    return participation


def sync_session_candidate_totals():
    sessions = ExamSession.objects.all()
    totals = {}
    for session_id in CandidateParticipation.objects.values_list('session_id', flat=True):
        totals[session_id] = totals.get(session_id, 0) + 1

    # Preserve older imports until their data migration has linked them.
    if not totals:
        sessions_by_code = {}
        for session in sessions:
            sessions_by_code.setdefault(clean_txt(session.code).upper(), []).append(session.id)
        for candidate in Candidate.objects.all():
            linked = list(candidate.session_ids or [])
            if not linked:
                for code in get_contest_codes(candidate.contests):
                    linked.extend(sessions_by_code.get(code, []))
            for session_id in set(linked):
                totals[session_id] = totals.get(session_id, 0) + 1

    for session in sessions:
        session.candidates_count = totals.get(session.id, 0)
        session.save(update_fields=['candidates_count', 'updated_at'])

EXPORT_HEADERS = [
    'Mã FT', 'Họ và tên thí sinh', 'Trường học', 'Lớp đang học', 'Tỉnh/Thành phố cư trú',
    'Cuộc thi đăng ký tham gia', 'Ngày sinh', 'Email liên lạc', 'Họ tên phụ huynh',
    'Số điện thoại liên lạc', 'Số CCCD/Hộ chiếu', 'Địa chỉ liên hệ',
]
for _round_number in (1, 2, 3):
    _prefix = f'Vòng {_round_number}: '
    EXPORT_HEADERS.extend([
        _prefix + 'Số báo danh', _prefix + 'Ngày thi', _prefix + 'Giờ/ca thi',
        _prefix + 'Hình thức thi', _prefix + 'Địa điểm/phòng thi', _prefix + 'Link thi',
        _prefix + 'Tài khoản/mã truy cập', _prefix + 'Mật khẩu', _prefix + 'Trạng thái dự thi', _prefix + 'Điểm',
        _prefix + 'Tỷ lệ điểm', _prefix + 'Xếp hạng', _prefix + 'Kết quả/giải thưởng',
        _prefix + 'Ghi chú/sự cố',
    ])


def _round_slots(round_results):
    slots = {}
    unnumbered = []
    for item in round_results:
        match = re.search(r'([1-3])', clean_txt(item.round_name))
        if match and int(match.group(1)) not in slots:
            slots[int(match.group(1))] = item
        else:
            unnumbered.append(item)
    for number in (1, 2, 3):
        if number not in slots and unnumbered:
            slots[number] = unnumbered.pop(0)
    return slots


def session_export_rows(session_id):
    """Build a re-importable flat export: one row per candidate/session, three round groups."""
    rows = [EXPORT_HEADERS]
    participations = (
        CandidateParticipation.objects.filter(session_id=session_id)
        .select_related('candidate')
        .prefetch_related('round_results')
        .order_by('candidate__sort_key', 'candidate__code')
    )
    for participation in participations:
        candidate = participation.candidate
        row = [
            candidate.code, candidate.name, candidate.school or '', candidate.class_name or '',
            candidate.city or '', candidate.contests or '', candidate.birth_date or '', candidate.email or '',
            candidate.parent or '', candidate.phone or '', candidate.identity or '', candidate.address or '',
        ]
        slots = _round_slots(list(participation.round_results.all()))
        for number in (1, 2, 3):
            result = slots.get(number)
            if not result:
                row.extend([''] * 14)
                continue
            row.extend([
                result.sbd, result.exam_date, result.time_slot, result.mode, result.location,
                result.link, result.account, result.password, result.attendance, result.score, result.score_rate,
                result.rank, result.result, result.note,
            ])
        rows.append(row)
    return rows


def _sheet_range_title(title):
    return "'" + title.replace("'", "''") + "'"


def export_session_to_google_sheet(sheet, google_access_token=None):
    session = ExamSession.objects.filter(id=sheet.session_id).first()
    if not session:
        raise ValueError('Không tìm thấy kỳ tổ chức được gắn với nguồn Google Sheets.')
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('Liên kết Google Sheets không hợp lệ.')

    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    service = build_sheets_service(google_access_token or saved_token, config_data or {})
    tab_name = clean_txt(sheet.sheet_tab) or f'{session.code} {session.time}'

    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields='sheets(properties(sheetId,title))',
    ).execute()
    titles = {
        item.get('properties', {}).get('title')
        for item in metadata.get('sheets', [])
        if item.get('properties', {}).get('title')
    }
    if tab_name not in titles:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={'requests': [{'addSheet': {'properties': {'title': tab_name}}}]},
        ).execute()

    values = session_export_rows(session.id)
    range_title = _sheet_range_title(tab_name)
    service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=range_title,
        body={},
    ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f'{range_title}!A1',
        valueInputOption='RAW',
        body={'values': values},
    ).execute()
    return {
        'success': True,
        'sessionId': session.id,
        'sheetTab': tab_name,
        'exported': max(0, len(values) - 1),
        'message': f'Đã xuất {max(0, len(values) - 1)} hồ sơ sang Google Sheets.',
    }


def get_google_sheet_csv_urls(spreadsheet_url):
    urls = []
    if '/d/e/' in spreadsheet_url:
        pub_url = spreadsheet_url
        if pub_url.endswith('/pubhtml') or pub_url.endswith('/pub'):
            pub_url = re.sub(r'/pub(html)?$', '/pub?output=csv', pub_url)
        elif 'output=csv' not in pub_url:
            pub_url = pub_url.split('?')[0] + '/pub?output=csv'
        urls.append(pub_url)
        
    sheet_id = ''
    id_match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', spreadsheet_url)
    if not id_match:
        id_match = re.search(r'[?&]id=([a-zA-Z0-9-_]+)', spreadsheet_url)
    if id_match:
        sheet_id = id_match.group(1)
        
    if sheet_id and sheet_id != 'e':
        gid_match = re.search(r'[?&#]gid=([0-9]+)', spreadsheet_url)
        gid_param = f"&gid={gid_match.group(1)}" if gid_match else ''
        
        urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv{gid_param}")
        urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv{gid_param}")
        urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/pub?output=csv{gid_param}")
        
    if not urls and (spreadsheet_url.startswith('http://') or spreadsheet_url.startswith('https://')):
        urls.append(spreadsheet_url)
        
    return urls

def sync_single_sheet(spreadsheet_url, ts_vn, sheet_doc_id=None, session_id=None):
    def update_state(data):
        if sheet_doc_id:
            try:
                sheet = ExaminationSheet.objects.get(id=sheet_doc_id)
                sheet.status = data.get('status', sheet.status)
                if 'error' in data:
                    pass  # ExaminationSheet has no note field
                sheet.updated_at = timezone.now()
                sheet.save()
            except Exception:
                pass

    try:
        candidate_urls = get_google_sheet_csv_urls(spreadsheet_url)
        if not candidate_urls:
            raise Exception('Đường dẫn Google Sheets không hợp lệ.')
            
        raw = ''
        last_error = None
        
        for csv_url in candidate_urls:
            print(f"[ExamSync] Downloading CSV: {csv_url}")
            try:
                res = requests.get(csv_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                }, timeout=15)
                
                if res.status_code in [401, 403]:
                    raise Exception('Sheet chưa mở quyền truy cập công khai. Vui lòng chia sẻ công khai.')
                res.raise_for_status()
                
                trimmed = res.text.strip()
                if 'accounts.google.com' in res.url or 'ServiceLogin' in res.url or trimmed.startswith('<!DOCTYPE html') or trimmed.startswith('<html'):
                    raise Exception('Sheet yêu cầu đăng nhập Google (Chưa mở quyền công khai).')
                if not trimmed:
                    raise Exception('Google Sheets trả về nội dung trống.')
                    
                raw = res.text
                last_error = None
                break
            except Exception as err:
                last_error = err
                if 'quyền truy cập' in str(err) or 'đăng nhập' in str(err):
                    break
                    
        if not raw and last_error:
            raise last_error
            
        # Parse CSV
        f = io.StringIO(raw)
        reader = csv.reader(f)
        grid = list(reader)
        
        if len(grid) < 2:
            raise Exception('Không tìm thấy dữ liệu trong tệp (cần ít nhất 1 dòng tiêu đề + 1 dòng dữ liệu).')
            
        header_index = next((index for index, row in enumerate(grid) if any('hovaten' in normalise_str(cell) or 'thisinh' in normalise_str(cell) for cell in row)), 0)
        header_row = merged_headers(grid, header_index)
        col = resolve_column_indices(header_row)
        
        incoming = []
        for ri in range(header_index + 1, len(grid)):
            row = grid[ri]
            if not row or len(row) <= max(col.values()):
                continue
                
            name = clean_txt(row[col['name']])
            if not name:
                continue
                
            raw_dob = clean_txt(row[col['dob']])
            birth_date = parse_dob(raw_dob)
            
            raw_contests = clean_txt(row[col['contests']])
            contests = ', '.join(get_contest_codes(raw_contests))
            
            identity = re.sub(r'\D', '', clean_txt(row[col['cccd']]))
            
            street = clean_txt(row[col.get('streetAddress', -1)]) if col.get('streetAddress', -1) >= 0 else ''
            ward = clean_txt(row[col.get('ward', -1)]) if col.get('ward', -1) >= 0 else ''
            city = clean_txt(row[col.get('city', -1)]) if col.get('city', -1) >= 0 else ''
            full = clean_txt(row[col.get('fullAddress', -1)]) if col.get('fullAddress', -1) >= 0 else ''
            address = full or ', '.join(filter(None, [street, ward, city]))
            
            amount = clean_txt(row[col.get('amount', -1)]) if col.get('amount', -1) >= 0 else ''
            invoice = clean_txt(row[col.get('invoice', -1)]) if col.get('invoice', -1) >= 0 else ''
            payment_status = clean_txt(row[col.get('paymentStatus', -1)]) if col.get('paymentStatus', -1) >= 0 else ''
            note = clean_txt(row[col.get('note', -1)]) if col.get('note', -1) >= 0 else ''
            
            achievement_parts = []
            if amount:
                achievement_parts.append(f"Lệ phí: {amount}")
            if payment_status and payment_status != '—':
                achievement_parts.append(payment_status)
            if invoice and invoice != 'x':
                achievement_parts.append(f"HĐ: {invoice}")
            achievement = ' | '.join(achievement_parts) or 'Đã nộp phí'
            
            email = clean_txt(row[col['email']])
            phone = re.sub(r'[^\d+]', '', clean_txt(row[col['phone']]))
            
            cand = {
                'name': name,
                'birth_date': birth_date,
                'identity': identity,
                'email': email,
                'phone': phone,
                'school': clean_txt(row[col['school']]),
                'class_name': clean_txt(row[col['className']]),
                'city': city,
                'address': address,
                'contests': contests,
                'achievement': achievement,
                'note': note,
                'parent': f"SĐT: {clean_txt(row[col['phone']])}" if phone else '',
                'updated': ts_vn,
                'exam_history': history_from_sheet_row(header_row, row),
            }
            incoming.append(cand)
            
        if not incoming:
            update_state({'status': 'success', 'error': None})
            return {
                'success': True,
                'message': 'Không có hồ sơ hợp lệ nào trong tệp.',
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn
            }
            
        # Perform Sync
        existing = list(Candidate.objects.all())
        existing_codes_set = {c.code for c in existing}
        
        created = 0
        updated = 0
        
        for i, cand in enumerate(incoming):
            # Match
            matched = None
            for e in existing:
                e_dict = {
                    'name': e.name,
                    'birth_date': e.birth_date,
                    'identity': e.identity,
                    'email': e.email,
                    'school': e.school
                }
                if same_candidate(e_dict, cand):
                    matched = e
                    break
                    
            if matched:
                matched.name = cand['name']
                if cand['birth_date']:
                    matched.birth_date = cand['birth_date']
                if cand['identity']:
                    matched.identity = cand['identity']
                if cand['email']:
                    matched.email = cand['email']
                if cand['phone']:
                    matched.phone = cand['phone']
                    matched.parent = cand['parent']
                if cand['school']:
                    matched.school = cand['school']
                if cand['class_name']:
                    matched.class_name = cand['class_name']
                if cand['city']:
                    matched.city = cand['city']
                if cand['address']:
                    matched.address = cand['address']
                # note is parsed but not stored on Candidate model
                    
                matched.contests = merge_contest_codes(matched.contests, cand['contests'])
                if session_id:
                    linked_sessions = list(matched.session_ids or [])
                    if session_id not in linked_sessions:
                        linked_sessions.append(session_id)
                    matched.session_ids = linked_sessions
                matched.updated = ts_vn
                matched.sort_key = f"{matched.name.lower()}_{matched.identity or matched.id}"
                matched.save()
                upsert_participation_history(matched, session_id, cand.get('exam_history'), spreadsheet_url)
                updated += 1
            else:
                code = next_code(existing_codes_set, len(existing) + i)
                c_id = code
                new_cand = Candidate.objects.create(
                    id=c_id,
                    code=code,
                    name=cand['name'],
                    birth_date=cand['birth_date'],
                    identity=cand['identity'],
                    email=cand['email'],
                    phone=cand['phone'],
                    school=cand['school'],
                    class_name=cand['class_name'],
                    city=cand['city'],
                    address=cand['address'],
                    contests=cand['contests'],
                    achievement=cand['achievement'],
                    # note is not a Candidate model field
                    parent=cand['parent'],
                    session_ids=[session_id] if session_id else [],
                    updated=ts_vn,
                    sort_key=f"{cand['name'].lower()}_{cand['identity'] or c_id}"
                )
                upsert_participation_history(new_cand, session_id, cand.get('exam_history'), spreadsheet_url)
                existing.append(new_cand)
                existing_codes_set.add(code)
                created += 1
                
        sync_session_candidate_totals()
        update_state({'status': 'success', 'error': None})
        
        return {
            'success': True,
            'message': f"Đồng bộ thành công – Thêm mới: {created}, Cập nhật: {updated}, Tổng: {len(incoming)}",
            'created': created,
            'updated': updated,
            'total': len(incoming),
            'timestamp': ts_vn
        }
    except Exception as e:
        msg = str(e)
        print(f"[ExamSync] Sync Error: {msg}")
        update_state({'status': 'failed', 'error': msg})
        return {
            'success': False,
            'message': f"Lỗi: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }

def sync_examination_from_google_sheet(spreadsheet_url=None, session_id=None, sheet_doc_id=None):
    ts_vn = datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')
    
    # helper to update system config state
    def update_global_state(data):
        try:
            config, _ = SystemConfig.objects.get_or_create(key='examination_sync_state')
            current = config.data or {}
            current.update(data)
            config.data = current
            config.save()
        except Exception:
            pass

    if spreadsheet_url:
        result = sync_single_sheet(spreadsheet_url, ts_vn, sheet_doc_id, session_id)
        update_global_state({
            'status': 'success' if result['success'] else 'failed',
            'lastSyncDate': ts_vn.split(' ')[0],
            'lastSyncTime': ts_vn,
            'lastSheetUrl': spreadsheet_url,
            'created': result['created'],
            'updated': result['updated'],
            'total': result['total'],
            'message': result['message'],
            'error': None if result['success'] else result['message']
        })
        return result
        
    # Else sync all configured sheets
    try:
        sheets = list(ExaminationSheet.objects.all())
        if not sheets:
            return {
                'success': False,
                'message': 'Chưa có tab nguồn nào được cấu hình.',
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn,
            }

        unassigned = [sheet.name for sheet in sheets if not sheet.session_id]
        if unassigned:
            return {
                'success': False,
                'message': 'Có tab nguồn chưa được gắn với kỳ tổ chức: ' + ', '.join(unassigned),
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn,
            }

        total_created = 0
        total_updated = 0
        total_candidates = 0
        success_count = 0
        error_messages = []
        
        for sheet in sheets:
            sheet.status = 'running'
            sheet.save()
            
            res = sync_single_sheet(sheet.url, ts_vn, sheet.id, sheet.session_id or None)
            if res['success']:
                total_created += res['created']
                total_updated += res['updated']
                total_candidates += res['total']
                success_count += 1
            else:
                error_messages.append(f"{sheet.name}: {res['message']}")
                
        status_text = f"Đã đồng bộ {success_count}/{len(sheets)} nguồn dữ liệu. (Tổng thêm mới: {total_created}, Cập nhật: {total_updated})"
        status = 'failed' if len(error_messages) == len(sheets) else 'success'
        
        update_global_state({
            'status': status,
            'lastSyncDate': ts_vn.split(' ')[0],
            'lastSyncTime': ts_vn,
            'created': total_created,
            'updated': total_updated,
            'total': total_candidates,
            'message': status_text,
            'error': '; '.join(error_messages) if error_messages else None
        })
        
        return {
            'success': status == 'success',
            'message': status_text,
            'created': total_created,
            'updated': total_updated,
            'total': total_candidates,
            'timestamp': ts_vn
        }
    except Exception as e:
        msg = str(e)
        update_global_state({
            'status': 'failed',
            'error': msg,
            'lastSyncTime': ts_vn
        })
        return {
            'success': False,
            'message': f"Lỗi: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }
