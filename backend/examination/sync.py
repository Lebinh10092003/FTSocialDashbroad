import io
import csv
import hashlib
import json
import re
import requests
import datetime
import uuid
import unicodedata
import urllib.parse
from django.utils import timezone
from .models import Candidate, CandidateParticipation, RoundResult, ExamSession, Competition, ExaminationSheet, LogNote
from .eligibility import normalize_eligibility
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

def format_person_name(value):
    """Normalize a person's name to title case while preserving Vietnamese accents."""
    words = re.sub(r'\s+', ' ', clean_txt(value)).split(' ')
    return ' '.join('-'.join(part[:1].upper() + part[1:].lower() for part in word.split('-') if part) for word in words if word)

def normalized_identity(value):
    digits = re.sub(r'\D', '', clean_txt(value))
    return digits if len(digits) >= 6 and len(set(digits)) > 1 else ''


def normalized_phone(value):
    digits = re.sub(r'\D', '', clean_txt(value))
    if digits.startswith('84') and len(digits) in {11, 12}:
        digits = '0' + digits[2:]
    return digits if len(digits) >= 9 and len(set(digits)) > 1 else ''


def normalized_email(value):
    email = clean_txt(value).casefold()
    return email if '@' in email and '.' in email.rsplit('@', 1)[-1] else ''


def birth_date_parts(value):
    raw = clean_txt(value)
    full = raw if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw) else ''
    year = raw[:4] if re.fullmatch(r'\d{4}(?:-\d{2}-\d{2})?', raw) else ''
    return year, full


def same_nonempty(a, b):
    left, right = normalise_str(a), normalise_str(b)
    return bool(left and right and left == right)


def should_replace_birth_date(existing_value, incoming_value):
    """Keep a known DD/MM/YYYY-equivalent ISO date when a later import has only its year."""
    _, existing_full = birth_date_parts(existing_value)
    _, incoming_full = birth_date_parts(incoming_value)
    return bool(clean_txt(incoming_value)) and not (existing_full and not incoming_full)


def candidate_match_assessment(a, b):
    """Classify matches using only reliable identifiers, then a strict fallback.

    CCCD, email and phone are the primary keys. Matching one of those plus the
    same name is safe to link automatically; the same identifier with a
    different name is surfaced for an operator to confirm. When at least one
    record is missing an identifier, a full name + full DOB + school + class is
    the only automatic fallback.
    """
    identity_a, identity_b = normalized_identity(a.get('identity')), normalized_identity(b.get('identity'))
    email_a, email_b = normalized_email(a.get('email')), normalized_email(b.get('email'))
    phone_a, phone_b = normalized_phone(a.get('phone')), normalized_phone(b.get('phone'))
    identifier_pairs = [
        ('CCCD/HÃ¡Â»â„¢ chiÃ¡ÂºÂ¿u', identity_a, identity_b),
        ('email', email_a, email_b),
        ('sÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', phone_a, phone_b),
    ]
    shared_identifiers = [label for label, left, right in identifier_pairs if left and right and left == right]
    name_matches = same_nonempty(a.get('name'), b.get('name'))

    if shared_identifiers:
        reason = ', '.join(shared_identifiers)
        if name_matches:
            return {'status': 'confirmed', 'reason': f'HÃ¡Â»Â tÃƒÂªn vÃƒÂ  {reason} trÃƒÂ¹ng'}
        return {'status': 'possible', 'reason': f'{reason} trÃƒÂ¹ng nhÃ†Â°ng hÃ¡Â»Â tÃƒÂªn khÃƒÂ¡c, cÃ¡ÂºÂ§n xÃƒÂ¡c nhÃ¡ÂºÂ­n'}

    # Do not use descriptive fields when both records already have a complete
    # but different identity footprint. It is very likely two people.
    identifiers_missing = any(not value for _, left, right in identifier_pairs for value in (left, right))
    if not identifiers_missing or not name_matches:
        return None

    year_a, full_a = birth_date_parts(a.get('birth_date'))
    year_b, full_b = birth_date_parts(b.get('birth_date'))
    if full_a and full_b and full_a != full_b:
        return None
    if year_a and year_b and year_a != year_b:
        return None

    school_matches = same_nonempty(a.get('school'), b.get('school'))
    class_matches = same_nonempty(a.get('class_name') or a.get('className'), b.get('class_name') or b.get('className'))
    full_birth_matches = bool(full_a and full_b and full_a == full_b)
    compatible_birth = bool(year_a and year_b and year_a == year_b)

    if full_birth_matches and school_matches and class_matches:
        return {'status': 'confirmed', 'reason': 'HÃ¡Â»Â tÃƒÂªn, ngÃƒÂ y sinh Ã„â€˜Ã¡ÂºÂ§y Ã„â€˜Ã¡Â»Â§, trÃ†Â°Ã¡Â»Âng vÃƒÂ  lÃ¡Â»â€ºp trÃƒÂ¹ng'}
    if compatible_birth and (school_matches or class_matches):
        return {'status': 'possible', 'reason': 'HÃ¡Â»Â tÃƒÂªn, nÃ„Æ’m/ngÃƒÂ y sinh vÃƒÂ  trÃ†Â°Ã¡Â»Âng hoÃ¡ÂºÂ·c lÃ¡Â»â€ºp trÃƒÂ¹ng, cÃ¡ÂºÂ§n xÃƒÂ¡c nhÃ¡ÂºÂ­n'}
    if school_matches and class_matches:
        return {'status': 'possible', 'reason': 'HÃ¡Â»Â tÃƒÂªn, trÃ†Â°Ã¡Â»Âng vÃƒÂ  lÃ¡Â»â€ºp trÃƒÂ¹ng nhÃ†Â°ng thiÃ¡ÂºÂ¿u ngÃƒÂ y sinh, cÃ¡ÂºÂ§n xÃƒÂ¡c nhÃ¡ÂºÂ­n'}
    return None


def same_candidate(a, b):
    assessment = candidate_match_assessment(a, b)
    return bool(assessment and assessment['status'] == 'confirmed')
def next_code(existing_codes_set, offset=0):
    """Return the next stable, human-readable FermatTech candidate code."""
    numbers = [int(match.group(1)) for code in existing_codes_set if (match := re.fullmatch(r'FT-(\d+)', str(code).strip().upper()))]
    seq = max(numbers, default=0) + 1 + max(offset, 0)
    candidate = f"FT-{seq:05d}"
    while candidate in existing_codes_set:
        seq += 1
        candidate = f"FT-{seq:05d}"
    return candidate

def parse_dob(raw):
    """Return a valid ISO date or a four-digit birth year from spreadsheet input."""
    cleaned = clean_txt(raw).replace(' ', '')
    cleaned = re.sub(r'[^0-9/\-.]', '', cleaned)
    if re.fullmatch(r'\d{4}', cleaned):
        return cleaned
    parts = [part for part in re.split(r'[/\-.]', cleaned) if part]
    if len(parts) != 3:
        return ''

    try:
        if len(parts[0]) == 4:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            first, second, last = int(parts[0]), int(parts[1]), parts[2]
            year = int(last)
            if len(last) == 2:
                year += 2000
            # Vietnamese templates use DD/MM/YYYY. When one part exceeds 12,
            # unambiguously accept the spreadsheet's US-style MM/DD/YY too.
            if first > 12:
                day, month = first, second
            elif second > 12:
                month, day = first, second
            else:
                day, month = first, second
        date_value = datetime.date(year, month, day)
        current_year = timezone.localdate().year
        if date_value.year < 1900 or date_value.year > current_year:
            return ''
        return date_value.isoformat()
    except (TypeError, ValueError):
        return ''
def resolve_column_indices(header):
    """Resolve both legacy sheets and the official two-row candidate template."""
    idx = {}
    for i, title in enumerate(header):
        nh = normalise_str(title)
        if 'code' not in idx and ('mahoso' in nh or 'maft' in nh):
            idx['code'] = i
        elif 'timestamp' not in idx and ('thoigian' in nh or 'timestamp' in nh):
            idx['timestamp'] = i
        elif 'stt' not in idx and (nh == 'stt' or nh.startswith('sott') or nh.endswith('stt')):
            idx['stt'] = i
        elif 'name' not in idx and ('hovantenthisinh' in nh or 'hovaten' in nh or 'thisinh' in nh or nh == 'ten'):
            idx['name'] = i
        elif 'amount' not in idx and ('sotiendanop' in nh or 'lephi' in nh or nh == 'tien'):
            idx['amount'] = i
        elif 'invoice' not in idx and ('hoadon' in nh or 'hoadien' in nh):
            idx['invoice'] = i
        elif 'contests' not in idx and ('kythidangky' in nh or 'dangkythi' in nh or 'dangthi' in nh or 'contest' in nh or 'kythi' in nh):
            idx['contests'] = i
        elif 'subject' not in idx and ('monthi' in nh or 'linhvuc' in nh):
            idx['subject'] = i
        elif 'category' not in idx and ('bangthi' in nh or 'category' in nh):
            idx['category'] = i
        elif 'registrationMethod' not in idx and ('hinhthucdangky' in nh or 'registrationmethod' in nh):
            idx['registrationMethod'] = i
        elif 'registrationUnit' not in idx and ('donvidangky' in nh or 'registrationunit' in nh):
            idx['registrationUnit'] = i
        elif 'teamName' not in idx and ('tendoinhom' in nh or 'doinhom' in nh or 'teamname' in nh):
            idx['teamName'] = i
        elif 'examLanguage' not in idx and ('ngonnguthi' in nh or 'examlanguage' in nh):
            idx['examLanguage'] = i
        elif 'generalNote' not in idx and ('ghichuchung' in nh or nh.endswith('ghichu') or 'generalnote' in nh):
            idx['generalNote'] = i
        elif 'certificateLink' not in idx and ('linkchungnhan' in nh or 'certificatelink' in nh):
            idx['certificateLink'] = i
        elif 'highestRound' not in idx and ('vongcaonhatdadat' in nh or 'highestround' in nh):
            idx['highestRound'] = i
        elif 'achievement' not in idx and ('ketquacaonhat' in nh or 'ketquathanhthich' in nh or 'achievement' in nh):
            idx['achievement'] = i
        elif 'updated' not in idx and ('ngaycapnhatgannhat' in nh or nh == 'updated'):
            idx['updated'] = i
        elif 'className' not in idx and ('hocsinhlop' in nh or ('lop' in nh and 'khoi' not in nh)):
            idx['className'] = i
        elif 'dob' not in idx and ('ngaythangnamsinh' in nh or 'namsinh' in nh or 'ngaysinh' in nh or 'dob' in nh or 'birthday' in nh):
            idx['dob'] = i
        elif 'grade' not in idx and ('khoithi' in nh or 'khoilop' in nh or nh == 'khoi'):
            idx['grade'] = i
        elif 'school' not in idx and ('truong' in nh and 'email' not in nh):
            idx['school'] = i
        elif 'cccd' not in idx and ('cccd' in nh or 'canchuan' in nh or 'dinhdanh' in nh or 'identity' in nh or 'cmnd' in nh):
            idx['cccd'] = i
        elif 'nationality' not in idx and ('quoctich' in nh or 'nationality' in nh):
            idx['nationality'] = i
        elif 'parent' not in idx and ('hotenphuhuynh' in nh or 'phuhuynh' in nh or 'parent' in nh):
            idx['parent'] = i
        elif 'streetAddress' not in idx and ('diachinh' in nh or 'diachinharieng' in nh):
            idx['streetAddress'] = i
        elif 'ward' not in idx and ('xaphuong' in nh or 'phuongxa' in nh or nh == 'phuong' or nh == 'xa'):
            idx['ward'] = i
        elif 'city' not in idx and ('tinhthanhpho' in nh or 'tinh' in nh or 'thanhpho' in nh or 'city' in nh):
            idx['city'] = i
        elif 'fullAddress' not in idx and ('diachilienhe' in nh or nh == 'diachi' or 'diachidaydu' in nh or 'address' in nh):
            idx['fullAddress'] = i
        elif 'email' not in idx and 'email' in nh:
            idx['email'] = i
        elif 'emailStatus' not in idx and ('tinhtranggui' in nh or 'guiemail' in nh):
            idx['emailStatus'] = i
        elif 'phone' not in idx and ('dienthoai' in nh or 'sdt' in nh or 'phone' in nh or 'giamho' in nh):
            idx['phone'] = i
        elif 'paymentStatus' not in idx and ('chuyenkhoan' in nh or 'noplephi' in nh or 'tinhtrangnop' in nh or 'thanhtoan' in nh):
            idx['paymentStatus'] = i
        elif 'note' not in idx and ('ghichusuco' in nh or nh == 'note' or 'ghichu' in nh):
            idx['note'] = i

    is_am_format = len(header) <= 15 or idx.get('contests') == 12
    if is_am_format:
        defaults = {'timestamp': 0, 'name': 1, 'dob': 2, 'className': 3, 'school': 4, 'city': 5, 'phone': 6, 'email': 7, 'cccd': 8, 'fullAddress': 9, 'paymentStatus': 10, 'note': 11, 'contests': 12}
    elif len(header) <= 25:
        defaults = {'timestamp': 0, 'stt': 1, 'name': 2, 'amount': 3, 'invoice': 4, 'contests': 5, 'className': 6, 'dob': 7, 'grade': 8, 'school': 9, 'cccd': 10, 'streetAddress': 11, 'ward': 12, 'city': 13, 'fullAddress': 14, 'email': 15, 'emailStatus': 16, 'phone': 17, 'paymentStatus': 18, 'note': 19}
    else:
        defaults = {}
    for key, value in defaults.items():
        idx.setdefault(key, value)
    return idx
ROUND_HISTORY_FIELD_MAP = {
    'eligibility': 'eligibility',
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
    inline_round_group = ''
    headers = []
    for index, label in enumerate(grid[header_index]):
        group = clean_txt(group_row[index]) if index < len(group_row) else ''
        if group:
            current_group = group
        title = clean_txt(label)
        normalized_title = normalise_str(title)
        if any(normalized_title.startswith(f'vong{number}') for number in (1, 2, 3)):
            inline_round_group = round_group_from_header(title)
        elif normalized_title.startswith('tonghop'):
            inline_round_group = ''
        if inline_round_group and title and not any(normalized_title.startswith(f'vong{number}') for number in (1, 2, 3)):
            title = f"{inline_round_group}: {title}"
        headers.append(f"{current_group}: {title}" if current_group and title else title)
    return headers


def round_group_from_header(header):
    raw = clean_txt(header)
    if ':' in raw:
        return raw.split(':', 1)[0].strip()
    field_labels = (
        'Ã„ÂiÃ¡Â»Âu kiÃ¡Â»â€¡n tham gia', 'SÃ¡Â»â€˜ bÃƒÂ¡o danh (SBD)', 'SÃ¡Â»â€˜ bÃƒÂ¡o danh', 'NgÃƒÂ y thi', 'GiÃ¡Â»Â/Ca thi',
        'HÃƒÂ¬nh thÃ¡Â»Â©c thi', 'Ã„ÂÃ¡Â»â€¹a Ã„â€˜iÃ¡Â»Æ’m/PhÃƒÂ²ng thi', 'Link thi', 'TÃƒÂ i khoÃ¡ÂºÂ£n/MÃƒÂ£ truy cÃ¡ÂºÂ­p',
        'MÃ¡ÂºÂ­t khÃ¡ÂºÂ©u', 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i dÃ¡Â»Â± thi', 'Ã„ÂiÃ¡Â»Æ’m', 'TÃ¡Â»Â· lÃ¡Â»â€¡ Ã„â€˜iÃ¡Â»Æ’m', 'XÃ¡ÂºÂ¿p hÃ¡ÂºÂ¡ng',
        'KÃ¡ÂºÂ¿t quÃ¡ÂºÂ£/GiÃ¡ÂºÂ£i thÃ†Â°Ã¡Â»Å¸ng', 'Ghi chÃƒÂº/SÃ¡Â»Â± cÃ¡Â»â€˜',
    )
    for label in field_labels:
        match = re.search(rf'\s+{re.escape(label)}\s*$', raw, flags=re.IGNORECASE)
        if match:
            return raw[:match.start()].strip()
    return raw


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
        source_group = ''
        for index, header in enumerate(headers):
            if index >= len(row):
                continue
            normalized = normalise_str(header)
            if not normalized.startswith(prefix):
                continue
            if not source_group:
                source_group = round_group_from_header(header)
            value = clean_txt(row[index])
            if not value:
                continue
            for key, aliases in field_aliases.items():
                # The generic alias "diem" also occurs inside a location header.
                # A score is the terminal field, never location or score rate.
                matches = (
                    normalized.endswith('diem') and 'diadiem' not in normalized and 'tylediem' not in normalized
                    if key == 'score'
                    else any(alias in normalized for alias in aliases)
                )
                if matches:
                    values[key] = value
                    break
        if values:
            values['eligibility'] = normalize_eligibility(values.get('eligibility'))
            detailed_name = source_group
            parts = re.split(r'\s*[Ã¢â‚¬â€œÃ¢â‚¬â€-]\s*', source_group, maxsplit=1)
            if len(parts) == 2 and normalise_str(parts[0]).startswith(f'vong{number}'):
                detailed_name = parts[1].strip()
            elif normalise_str(source_group) == f'vong{number}':
                detailed_name = ''
            values['round'] = detailed_name or ('V' + chr(242) + 'ng ' + str(number))
            rounds.append(values)
    return rounds


def sync_candidate_payload(candidate):
    """Return the same record shape accepted by the reviewed import endpoint."""
    return {
        'code': candidate.get('code', ''), 'name': candidate.get('name', ''),
        'birthDate': candidate.get('birth_date', ''), 'identity': candidate.get('identity', ''),
        'email': candidate.get('email', ''), 'phone': candidate.get('phone', ''),
        'school': candidate.get('school', ''), 'className': candidate.get('class_name', ''),
        'city': candidate.get('city', ''), 'ward': candidate.get('ward', ''),
        'nationality': candidate.get('nationality', ''), 'grade': candidate.get('grade', ''),
        'address': candidate.get('address', ''), 'contests': candidate.get('contests', ''),
        'achievement': candidate.get('achievement', ''), 'highestRound': candidate.get('highest_round', ''),
        'parent': candidate.get('parent', ''), 'updated': candidate.get('updated', ''),
        'subject': candidate.get('registration', {}).get('subject', ''),
        'category': candidate.get('registration', {}).get('category', ''),
        'registrationMethod': candidate.get('registration', {}).get('registrationMethod', ''),
        'registrationUnit': candidate.get('registration', {}).get('registrationUnit', ''),
        'teamName': candidate.get('registration', {}).get('teamName', ''),
        'examLanguage': candidate.get('registration', {}).get('examLanguage', ''),
        'generalNote': candidate.get('registration', {}).get('generalNote', ''),
        'certificateLink': candidate.get('registration', {}).get('certificateLink', ''),
        'examHistory': candidate.get('exam_history', []),
    }


def build_sheet_preview(incoming, headers, columns, raw, session_id, source_url, sheet_tab='', source_row_offset=1):
    existing = list(Candidate.objects.all())
    created = matched = conflicts = changed = unchanged = 0
    rows = []
    profile_fields = (
        ('name', 'name'), ('birth_date', 'birth_date'), ('identity', 'identity'), ('email', 'email'),
        ('phone', 'phone'), ('school', 'school'), ('class_name', 'class_name'), ('city', 'city'),
        ('ward', 'ward'), ('nationality', 'nationality'), ('grade', 'grade'), ('address', 'address'),
        ('achievement', 'achievement'), ('highest_round', 'highest_round'), ('parent', 'parent'),
    )
    for source_index, item in enumerate(incoming, start=source_row_offset):
        assessments = []
        for candidate in existing:
            assessment = candidate_match_assessment({
                'name': candidate.name, 'birth_date': candidate.birth_date, 'identity': candidate.identity,
                'email': candidate.email, 'phone': candidate.phone, 'school': candidate.school,
                'class_name': candidate.class_name, 'city': candidate.city, 'ward': candidate.ward,
                'address': candidate.address,
            }, item)
            if assessment:
                assessments.append((candidate, assessment))
        confirmed = [(candidate, assessment) for candidate, assessment in assessments if assessment['status'] == 'confirmed']
        same_code = next((candidate for candidate in existing if item.get('code') and candidate.code.upper() == item['code'].upper()), None)
        base = confirmed[0][0] if len(confirmed) == 1 else same_code
        possible = [(candidate, assessment) for candidate, assessment in assessments if assessment['status'] == 'possible']
        changed_fields = []
        if base:
            matched += 1
            for model_field, incoming_field in profile_fields:
                incoming_value = clean_txt(item.get(incoming_field))
                if incoming_value and clean_txt(getattr(base, model_field)) != incoming_value:
                    changed_fields.append(model_field)
            participation = CandidateParticipation.objects.filter(candidate=base, session_id=session_id).prefetch_related('round_results').first() if session_id else None
            if not participation:
                changed_fields.append('session')
            else:
                registration_fields = {
                    'subject': 'subject', 'category': 'category', 'registrationMethod': 'registration_method',
                    'registrationUnit': 'registration_unit', 'teamName': 'team_name', 'examLanguage': 'exam_language',
                    'generalNote': 'general_note', 'certificateLink': 'certificate_link',
                }
                for incoming_field, model_field in registration_fields.items():
                    incoming_value = clean_txt((item.get('registration') or {}).get(incoming_field))
                    if incoming_value and clean_txt(getattr(participation, model_field)) != incoming_value:
                        changed_fields.append(f'registration.{incoming_field}')
                existing_rounds = list(participation.round_results.all())
                for history_index, history_item in enumerate(item.get('exam_history') or []):
                    incoming_round = clean_txt(history_item.get('round'))
                    existing_round = next((round_item for round_item in existing_rounds if clean_txt(round_item.round_name).casefold() == incoming_round.casefold()), None)
                    if not existing_round and history_index < len(existing_rounds):
                        existing_round = existing_rounds[history_index]
                    if not existing_round:
                        changed_fields.append(f'round.{incoming_round}')
                        continue
                    for payload_field, model_field in ROUND_HISTORY_FIELD_MAP.items():
                        incoming_value = clean_txt(history_item.get(payload_field))
                        if payload_field == 'date' and incoming_value:
                            incoming_value = parse_dob(incoming_value) or incoming_value
                        if incoming_value and clean_txt(getattr(existing_round, model_field)) != incoming_value:
                            changed_fields.append(f'round.{incoming_round}.{payload_field}')
            if changed_fields:
                changed += 1
            else:
                unchanged += 1
        is_conflict = len(confirmed) > 1 or (not base and possible)
        if is_conflict:
            conflicts += 1
            if base:
                matched -= 1
                if changed_fields:
                    changed -= 1
                else:
                    unchanged -= 1
        elif not base:
            created += 1
        payload = sync_candidate_payload(item)
        payload['_preview'] = {
            'sourceRow': source_index,
            'status': 'conflict' if is_conflict else ('new' if not base else ('changed' if changed_fields else 'unchanged')),
            'matchedCode': base.code if base else '',
            'changedFields': changed_fields,
        }
        rows.append(payload)

    mapped = []
    used_indices = set()
    for field, index in columns.items():
        if isinstance(index, int) and 0 <= index < len(headers):
            mapped.append({'field': field, 'column': headers[index], 'index': index + 1})
            used_indices.add(index)
    for index, header in enumerate(headers):
        normalized = normalise_str(header)
        if index not in used_indices and any(normalized.startswith(f'vong{number}') for number in (1, 2, 3)):
            mapped.append({'field': 'examHistory', 'column': header, 'index': index + 1})
            used_indices.add(index)
    round_groups = []
    for header in headers:
        group = round_group_from_header(header)
        if normalise_str(group).startswith('vong') and group not in round_groups:
            round_groups.append(group)
    warnings = []
    if 'name' not in columns:
        warnings.append('KhÃƒÂ´ng nhÃ¡ÂºÂ­n diÃ¡Â»â€¡n Ã„â€˜Ã†Â°Ã¡Â»Â£c cÃ¡Â»â„¢t HÃ¡Â»Â vÃƒÂ  tÃƒÂªn thÃƒÂ­ sinh.')
    if not any(field in columns for field in ('cccd', 'email', 'phone')):
        warnings.append('KhÃƒÂ´ng cÃƒÂ³ CCCD, email hoÃ¡ÂºÂ·c sÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i; viÃ¡Â»â€¡c Ã„â€˜Ã¡Â»â€˜i chiÃ¡ÂºÂ¿u hÃ¡Â»â€œ sÃ†Â¡ trÃƒÂ¹ng sÃ¡ÂºÂ½ kÃƒÂ©m chÃƒÂ­nh xÃƒÂ¡c.')
    if conflicts:
        warnings.append(f'CÃƒÂ³ {conflicts} hÃ¡Â»â€œ sÃ†Â¡ cÃ¡ÂºÂ§n ngÃ†Â°Ã¡Â»Âi dÃƒÂ¹ng xÃƒÂ¡c nhÃ¡ÂºÂ­n trÃ†Â°Ã¡Â»â€ºc khi nhÃ¡ÂºÂ­p.')
    return {
        'success': True,
        'records': rows,
        'summary': {
            'total': len(rows), 'new': created, 'matched': matched, 'changed': changed,
            'unchanged': unchanged, 'conflicts': conflicts,
        },
        'mapping': {
            'headerCount': len(headers), 'mapped': mapped,
            'unmapped': [header for index, header in enumerate(headers) if header and index not in used_indices],
            'roundGroups': round_groups,
        },
        'warnings': warnings,
        'source': {
            'url': source_url, 'sheetTab': sheet_tab,
            'fingerprint': hashlib.sha256(raw.encode('utf-8')).hexdigest(),
        },
    }


def upsert_participation_history(candidate, session_id, history, source='', registration=None):
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
    updates = []
    if source and participation.source != source:
        participation.source = source
        updates.append('source')
    registration = registration or {}
    registration_fields = {
        'subject': 'subject', 'category': 'category', 'registrationMethod': 'registration_method',
        'registrationUnit': 'registration_unit', 'teamName': 'team_name', 'examLanguage': 'exam_language',
        'generalNote': 'general_note', 'certificateLink': 'certificate_link',
    }
    for payload_field, model_field in registration_fields.items():
        value = clean_txt(registration.get(payload_field))
        if value:
            setattr(participation, model_field, value)
            updates.append(model_field)
    if registration:
        participation.registration_data = {str(key): value for key, value in registration.items() if value not in (None, '')}
        updates.append('registration_data')
    if updates:
        participation.save(update_fields=list(set(updates)) + ['updated_at'])
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
        if values.get('eligibility'):
            values['eligibility'] = normalize_eligibility(values['eligibility'])
        if values.get('exam_date'):
            values['exam_date'] = parse_dob(values['exam_date']) or values['exam_date']
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

def append_existing_candidate_link_note(candidate, session_id, previous_session_ids):
    """Leave a readable trace when an import reuses a profile in another session."""
    session = ExamSession.objects.filter(id=session_id).first()
    if not session:
        return
    previous_sessions = list(ExamSession.objects.filter(id__in=previous_session_ids).exclude(id=session_id).values_list('code', 'name'))
    previous_label = ', '.join(f'{code} Ã‚Â· {name}' for code, name in previous_sessions) or 'chÃ†Â°a cÃƒÂ³ kÃ¡Â»Â³ tÃ¡Â»â€¢ chÃ¡Â»Â©c khÃƒÂ¡c Ã„â€˜Ã†Â°Ã¡Â»Â£c ghi nhÃ¡ÂºÂ­n'
    LogNote.objects.create(
        key=f'candidate-{candidate.code}:import-link:{uuid.uuid4().hex}',
        entity_key=f'candidate-{candidate.code}',
        content=f'HÃ¡Â»â€¡ thÃ¡Â»â€˜ng nhÃ¡ÂºÂ­n diÃ¡Â»â€¡n hÃ¡Â»â€œ sÃ†Â¡ Ã„â€˜ÃƒÂ£ cÃƒÂ³. Ã„ÂÃƒÂ£ bÃ¡Â»â€¢ sung dÃ¡Â»Â¯ liÃ¡Â»â€¡u vÃƒÂ o kÃ¡Â»Â³ tÃ¡Â»â€¢ chÃ¡Â»Â©c {session.code} Ã‚Â· {session.name}. ThÃƒÂ­ sinh Ã„â€˜ÃƒÂ£ tÃ¡Â»Â«ng thi: {previous_label}.',
        updated_by='HÃ¡Â»â€¡ thÃ¡Â»â€˜ng FT Workspace',
        system=True,
    )
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

PROFILE_EXPORT_HEADERS = [
    'STT', 'MÃƒÂ£ hÃ¡Â»â€œ sÃ†Â¡', 'HÃ¡Â»Â vÃƒÂ  tÃƒÂªn thÃƒÂ­ sinh', 'NgÃƒÂ y sinh', 'SÃ¡Â»â€˜ CCCD/HÃ¡Â»â„¢ chiÃ¡ÂºÂ¿u', 'QuÃ¡Â»â€˜c tÃ¡Â»â€¹ch',
    'HÃ¡Â»Â tÃƒÂªn phÃ¡Â»Â¥ huynh', 'SÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', 'Email', 'TÃ¡Â»â€°nh/ThÃƒÂ nh phÃ¡Â»â€˜', 'XÃƒÂ£/phÃ†Â°Ã¡Â»Âng', 'Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€° liÃƒÂªn hÃ¡Â»â€¡',
    'TrÃ†Â°Ã¡Â»Âng', 'LÃ¡Â»â€ºp Ã„â€˜ang hÃ¡Â»Âc (vÃƒÂ­ dÃ¡Â»Â¥: 6A1)', 'KhÃ¡Â»â€˜i lÃ¡Â»â€ºp',
]
REGISTRATION_EXPORT_HEADERS = ['MÃƒÂ´n thi/LÃ„Â©nh vÃ¡Â»Â±c', 'BÃ¡ÂºÂ£ng thi/Category', 'HÃƒÂ¬nh thÃ¡Â»Â©c Ã„â€˜Ã„Æ’ng kÃƒÂ½', 'TÃƒÂªn Ã„â€˜Ã¡Â»â„¢i/NhÃƒÂ³m', 'NgÃƒÂ´n ngÃ¡Â»Â¯ thi', 'Ghi chÃƒÂº']
ROUND_EXPORT_HEADERS = [
    'Ã„ÂiÃ¡Â»Âu kiÃ¡Â»â€¡n tham gia', 'SÃ¡Â»â€˜ bÃƒÂ¡o danh (SBD)', 'NgÃƒÂ y thi', 'GiÃ¡Â»Â/Ca thi', 'HÃƒÂ¬nh thÃ¡Â»Â©c thi', 'Ã„ÂÃ¡Â»â€¹a Ã„â€˜iÃ¡Â»Æ’m/PhÃƒÂ²ng thi',
    'Link thi', 'TÃƒÂ i khoÃ¡ÂºÂ£n/MÃƒÂ£ truy cÃ¡ÂºÂ­p', 'MÃ¡ÂºÂ­t khÃ¡ÂºÂ©u', 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i dÃ¡Â»Â± thi', 'Ã„ÂiÃ¡Â»Æ’m', 'TÃ¡Â»Â· lÃ¡Â»â€¡ Ã„â€˜iÃ¡Â»Æ’m', 'XÃ¡ÂºÂ¿p hÃ¡ÂºÂ¡ng',
    'KÃ¡ÂºÂ¿t quÃ¡ÂºÂ£/GiÃ¡ÂºÂ£i thÃ†Â°Ã¡Â»Å¸ng', 'Ghi chÃƒÂº/SÃ¡Â»Â± cÃ¡Â»â€˜',
]
SUMMARY_EXPORT_HEADERS = ['VÃƒÂ²ng cao nhÃ¡ÂºÂ¥t Ã„â€˜ÃƒÂ£ Ã„â€˜Ã¡ÂºÂ¡t', 'KÃ¡ÂºÂ¿t quÃ¡ÂºÂ£ cao nhÃ¡ÂºÂ¥t', 'Link chÃ¡Â»Â©ng nhÃ¡ÂºÂ­n', 'NgÃƒÂ y cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t gÃ¡ÂºÂ§n nhÃ¡ÂºÂ¥t']
EXPORT_HEADERS = PROFILE_EXPORT_HEADERS + REGISTRATION_EXPORT_HEADERS + ROUND_EXPORT_HEADERS * 3 + SUMMARY_EXPORT_HEADERS
EXPORT_GROUP_HEADERS = (
    ['HÃ¡Â»â€™ SÃ†Â  THÃƒÂ SINH'] + [''] * (len(PROFILE_EXPORT_HEADERS) - 1)
    + ['THÃƒâ€NG TIN Ã„ÂÃ„â€šNG KÃƒÂ'] + [''] * (len(REGISTRATION_EXPORT_HEADERS) - 1)
    + ['VÃƒâ€™NG 1'] + [''] * (len(ROUND_EXPORT_HEADERS) - 1)
    + ['VÃƒâ€™NG 2'] + [''] * (len(ROUND_EXPORT_HEADERS) - 1)
    + ['VÃƒâ€™NG 3'] + [''] * (len(ROUND_EXPORT_HEADERS) - 1)
    + ['TÃ¡Â»â€NG HÃ¡Â»Â¢P'] + [''] * (len(SUMMARY_EXPORT_HEADERS) - 1)
)

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
    """Build a re-importable export matching the official candidate template."""
    rows = [EXPORT_GROUP_HEADERS, EXPORT_HEADERS]
    participations = (
        CandidateParticipation.objects.filter(session_id=session_id)
        .select_related('candidate')
        .prefetch_related('round_results')
        .order_by('candidate__sort_key', 'candidate__code')
    )
    for sequence, participation in enumerate(participations, start=1):
        candidate = participation.candidate
        row = [
            sequence, candidate.code, candidate.name, candidate.birth_date or '', candidate.identity or '', candidate.nationality or '',
            candidate.parent or '', candidate.phone or '', candidate.email or '', candidate.city or '', candidate.ward or '', candidate.address or '',
            candidate.school or '', candidate.class_name or '', candidate.grade or '',
            participation.subject or '', participation.category or '', participation.registration_method or '', participation.team_name or '',
            participation.exam_language or '', participation.general_note or '',
        ]
        slots = _round_slots(list(participation.round_results.all()))
        for number in (1, 2, 3):
            result = slots.get(number)
            if not result:
                row.extend([''] * len(ROUND_EXPORT_HEADERS))
                continue
            row.extend([
                result.eligibility, result.sbd, result.exam_date, result.time_slot, result.mode, result.location,
                result.link, result.account, result.password, result.attendance, result.score, result.score_rate,
                result.rank, result.result, result.note,
            ])
        row.extend([candidate.highest_round or '', candidate.achievement or '', participation.certificate_link or '', candidate.updated or ''])
        rows.append(row)
    return rows

def _sheet_range_title(title):
    return "'" + title.replace("'", "''") + "'"


def _column_name(index):
    """Return the familiar A1 column name for a zero-based index."""
    name = ''
    number = index + 1
    while number:
        number, remainder = divmod(number - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _output_sheet_target(sheet, service):
    """Resolve an existing output tab from its configured name or URL gid."""
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields='sheets(properties(sheetId,title))',
    ).execute()
    tabs = [item.get('properties', {}) for item in metadata.get('sheets', [])]
    parsed_url = urllib.parse.urlparse(clean_txt(sheet.url))
    query = urllib.parse.parse_qs(parsed_url.query)
    fragment = urllib.parse.parse_qs(parsed_url.fragment)
    gid = (query.get('gid') or fragment.get('gid') or [''])[0]
    if gid:
        for tab in tabs:
            if str(tab.get('sheetId')) == str(gid):
                requested_title = clean_txt(sheet.sheet_tab)
                if requested_title and tab.get('title') != requested_title:
                    raise ValueError(
                        f'Link Ä‘ang trá» Ä‘áº¿n tab â€œ{tab.get("title")}â€ (gid={gid}) nhÆ°ng tÃªn tab Ä‘Ã£ khai bÃ¡o lÃ  '
                        f'â€œ{requested_title}â€. HÃ£y sá»­a tÃªn tab hoáº·c dÃ¡n Ä‘Ãºng liÃªn káº¿t cá»§a tab cáº§n xuáº¥t.'
                    )
                return tab
        raise ValueError('LiÃªn káº¿t Google Sheet cÃ³ gid nhÆ°ng khÃ´ng tÃ¬m tháº¥y tab tÆ°Æ¡ng á»©ng.')
    requested_title = clean_txt(sheet.sheet_tab)
    if requested_title:
        for tab in tabs:
            if tab.get('title') == requested_title:
                return tab
        raise ValueError(f'KhÃ´ng tÃ¬m tháº¥y tab â€œ{requested_title}â€ trong Google Sheet Ä‘Ã£ liÃªn káº¿t.')
    raise ValueError('Sheet tÃ¡Â»â€¢ng hÃ¡Â»Â£p chÃ†Â°a khai bÃƒÂ¡o tab. HÃƒÂ£y chÃ¡Â»Ân Ã„â€˜ÃƒÂºng tab cÃ¡ÂºÂ§n xuÃ¡ÂºÂ¥t; hÃ¡Â»â€¡ thÃ¡Â»â€˜ng sÃ¡ÂºÂ½ khÃƒÂ´ng tÃ¡Â»Â± tÃ¡ÂºÂ¡o tab mÃ¡Â»â€ºi.')


def output_sheet_export_preview(sheet, google_access_token=None, max_changes=250):
    """Read-only comparison of the existing tab and the values to export."""
    session = ExamSession.objects.filter(id=sheet.session_id).first()
    if not session:
        raise ValueError('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y kÃ¡Â»Â³ tÃ¡Â»â€¢ chÃ¡Â»Â©c Ã„â€˜Ã†Â°Ã¡Â»Â£c gÃ¡ÂºÂ¯n vÃ¡Â»â€ºi nguÃ¡Â»â€œn Google Sheets.')
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('LiÃƒÂªn kÃ¡ÂºÂ¿t Google Sheets khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.')
    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    service = build_sheets_service(google_access_token or saved_token, config_data or {})
    target = _output_sheet_target(sheet, service)
    tab_name = target.get('title')
    current = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=_sheet_range_title(tab_name),
    ).execute().get('values', [])
    proposed = session_export_rows(session.id)
    changes, changed_rows, changed_cells = [], set(), 0
    header_rows = [row for row in proposed[:2] if row]
    for row_index in range(max(len(current), len(proposed))):
        before_row = current[row_index] if row_index < len(current) else []
        after_row = proposed[row_index] if row_index < len(proposed) else []
        record_row = after_row or before_row
        record_label = 'Header row'
        if row_index >= 2 and record_row:
            profile_code = str(record_row[1]) if len(record_row) > 1 and record_row[1] else ''
            candidate_name = str(record_row[2]) if len(record_row) > 2 and record_row[2] else ''
            record_label = ' - '.join(item for item in [profile_code, candidate_name] if item) or f'Data row {row_index + 1}'
        for column_index in range(max(len(before_row), len(after_row))):
            before = str(before_row[column_index]) if column_index < len(before_row) else ''
            after = str(after_row[column_index]) if column_index < len(after_row) else ''
            if before == after:
                continue
            changed_cells += 1
            changed_rows.add(row_index + 1)
            if len(changes) < max_changes:
                column = _column_name(column_index)
                field = next(
                    (str(headers[column_index]) for headers in reversed(header_rows) if len(headers) > column_index and headers[column_index]),
                    column,
                )
                changes.append({
                    'row': row_index + 1,
                    'rowLabel': record_label,
                    'column': column,
                    'field': field,
                    'cell': f'{column}{row_index + 1}',
                    'current': before,
                    'next': after,
                })
    return {
        'spreadsheetId': spreadsheet_id, 'sheetTab': tab_name, 'sheetId': str(target.get('sheetId', '')),
        'currentFingerprint': sheet_values_fingerprint(current), 'proposedFingerprint': sheet_values_fingerprint(proposed),
        'currentRows': len(current), 'proposedRows': len(proposed), 'changedCells': changed_cells,
        'changedRows': len(changed_rows), 'changes': changes, 'changesTruncated': changed_cells > len(changes),
        'hasExistingData': bool(current), 'hasChanges': bool(changed_cells),
    }

def sheet_values_fingerprint(values):
    """Stable fingerprint used to detect edits made in an output Sheet."""
    payload = json.dumps(values or [], ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def remote_sheet_fingerprint(sheet, google_access_token=None):
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('LiÃƒÂªn kÃ¡ÂºÂ¿t Google Sheets khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.')
    session = ExamSession.objects.filter(id=sheet.session_id).first()
    if not session:
        raise ValueError('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y kÃ¡Â»Â³ tÃ¡Â»â€¢ chÃ¡Â»Â©c Ã„â€˜Ã†Â°Ã¡Â»Â£c gÃ¡ÂºÂ¯n vÃ¡Â»â€ºi Google Sheets.')
    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    service = build_sheets_service(google_access_token or saved_token, config_data or {})
    tab_name = _output_sheet_target(sheet, service).get('title')
    values = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=_sheet_range_title(tab_name),
    ).execute().get('values', [])
    return sheet_values_fingerprint(values)


def export_session_to_google_sheet(sheet, google_access_token=None):
    session = ExamSession.objects.filter(id=sheet.session_id).first()
    if not session:
        raise ValueError('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y kÃ¡Â»Â³ tÃ¡Â»â€¢ chÃ¡Â»Â©c Ã„â€˜Ã†Â°Ã¡Â»Â£c gÃ¡ÂºÂ¯n vÃ¡Â»â€ºi nguÃ¡Â»â€œn Google Sheets.')
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('LiÃƒÂªn kÃ¡ÂºÂ¿t Google Sheets khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.')

    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    service = build_sheets_service(google_access_token or saved_token, config_data or {})
    tab_name = _output_sheet_target(sheet, service).get('title')

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
        'fingerprint': sheet_values_fingerprint(values),
        'message': f'Ã„ÂÃƒÂ£ xuÃ¡ÂºÂ¥t {max(0, len(values) - 1)} hÃ¡Â»â€œ sÃ†Â¡ sang Google Sheets.',
    }


def get_google_sheet_csv_urls(spreadsheet_url, sheet_tab=''):
    parsed_source = urllib.parse.urlparse(clean_txt(spreadsheet_url))
    if parsed_source.scheme != 'https' or parsed_source.hostname != 'docs.google.com' or not parsed_source.path.startswith('/spreadsheets/'):
        return []
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

        if clean_txt(sheet_tab):
            encoded_tab = urllib.parse.quote(clean_txt(sheet_tab), safe='')
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded_tab}")
        else:
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv{gid_param}")
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv{gid_param}")
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/pub?output=csv{gid_param}")
        
    return urls

def sync_single_sheet(spreadsheet_url, ts_vn, sheet_doc_id=None, session_id=None, preview=False, sheet_tab=''):
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
        candidate_urls = get_google_sheet_csv_urls(spreadsheet_url, sheet_tab)
        if not candidate_urls:
            raise Exception('Ã„ÂÃ†Â°Ã¡Â»Âng dÃ¡ÂºÂ«n Google Sheets khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.')
            
        raw = ''
        last_error = None
        
        for csv_url in candidate_urls:
            try:
                res = requests.get(csv_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                }, timeout=15)
                
                if res.status_code in [401, 403]:
                    raise Exception('Sheet chÃ†Â°a mÃ¡Â»Å¸ quyÃ¡Â»Ân truy cÃ¡ÂºÂ­p cÃƒÂ´ng khai. Vui lÃƒÂ²ng chia sÃ¡ÂºÂ» cÃƒÂ´ng khai.')
                res.raise_for_status()
                
                res.encoding = 'utf-8'
                trimmed = res.text.strip()
                if 'accounts.google.com' in res.url or 'ServiceLogin' in res.url or trimmed.startswith('<!DOCTYPE html') or trimmed.startswith('<html'):
                    raise Exception('Sheet yÃƒÂªu cÃ¡ÂºÂ§u Ã„â€˜Ã„Æ’ng nhÃ¡ÂºÂ­p Google (ChÃ†Â°a mÃ¡Â»Å¸ quyÃ¡Â»Ân cÃƒÂ´ng khai).')
                if not trimmed:
                    raise Exception('Google Sheets trÃ¡ÂºÂ£ vÃ¡Â»Â nÃ¡Â»â„¢i dung trÃ¡Â»â€˜ng.')
                    
                raw = res.text
                last_error = None
                break
            except Exception as err:
                last_error = err
                if 'quyÃ¡Â»Ân truy cÃ¡ÂºÂ­p' in str(err) or 'Ã„â€˜Ã„Æ’ng nhÃ¡ÂºÂ­p' in str(err):
                    break
                    
        if not raw and last_error:
            raise last_error
            
        # Parse CSV
        f = io.StringIO(raw)
        reader = csv.reader(f)
        grid = list(reader)
        
        if len(grid) < 2:
            raise Exception('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y dÃ¡Â»Â¯ liÃ¡Â»â€¡u trong tÃ¡Â»â€¡p (cÃ¡ÂºÂ§n ÃƒÂ­t nhÃ¡ÂºÂ¥t 1 dÃƒÂ²ng tiÃƒÂªu Ã„â€˜Ã¡Â»Â + 1 dÃƒÂ²ng dÃ¡Â»Â¯ liÃ¡Â»â€¡u).')
            
        header_candidates = []
        for index in range(min(len(grid), 20)):
            candidate_header = merged_headers(grid, index)
            candidate_columns = resolve_column_indices(candidate_header)
            if 'name' in candidate_columns:
                header_candidates.append((len(candidate_columns), index))
        header_index = max(header_candidates, default=(0, 0))[1]
        header_row = merged_headers(grid, header_index)
        col = resolve_column_indices(header_row)
        
        incoming = []
        session_code = clean_txt(ExamSession.objects.filter(id=session_id).values_list('code', flat=True).first()) if session_id else ''
        for row in grid[header_index + 1:]:
            if not row:
                continue

            def value(field):
                index = col.get(field)
                return clean_txt(row[index]) if index is not None and index < len(row) else ''

            name = format_person_name(value('name'))
            if not name:
                continue
            raw_contests = value('contests')
            contests = merge_contest_codes(raw_contests, session_code)
            amount, invoice, payment_status = value('amount'), value('invoice'), value('paymentStatus')
            legacy_achievement = []
            if amount:
                legacy_achievement.append(f"LÃ¡Â»â€¡ phÃƒÂ­: {amount}")
            if payment_status and payment_status != 'Ã¢â‚¬â€':
                legacy_achievement.append(payment_status)
            if invoice and invoice != 'x':
                legacy_achievement.append(f"HÃ„Â: {invoice}")
            registration = {
                'subject': value('subject'), 'category': value('category'), 'registrationMethod': value('registrationMethod'),
                'registrationUnit': value('registrationUnit'), 'teamName': value('teamName'), 'examLanguage': value('examLanguage'),
                'generalNote': value('generalNote'), 'certificateLink': value('certificateLink'),
            }
            cand = {
                'code': value('code'), 'name': name, 'birth_date': parse_dob(value('dob')), 'identity': re.sub(r'\D', '', value('cccd')),
                'email': value('email'), 'phone': re.sub(r'[^\d+]', '', value('phone')), 'school': value('school'),
                'class_name': value('className'), 'city': value('city'), 'ward': value('ward'), 'nationality': value('nationality'),
                'grade': value('grade'), 'address': value('fullAddress') or ', '.join(filter(None, [value('streetAddress'), value('ward'), value('city')])),
                'contests': contests, 'achievement': value('achievement') or ' | '.join(legacy_achievement), 'highest_round': value('highestRound'),
                'parent': format_person_name(value('parent')), 'updated': value('updated') or ts_vn, 'registration': registration,
                'exam_history': history_from_sheet_row(header_row, row),
            }
            incoming.append(cand)
            if len(incoming) > 1000:
                raise Exception('MÃ¡Â»â€”i lÃ¡ÂºÂ§n chÃ¡Â»â€° Ã„â€˜Ã†Â°Ã¡Â»Â£c xÃ¡Â»Â­ lÃƒÂ½ tÃ¡Â»â€˜i Ã„â€˜a 1.000 hÃ¡Â»â€œ sÃ†Â¡. HÃƒÂ£y chia tab nguÃ¡Â»â€œn thÃƒÂ nh nhiÃ¡Â»Âu Ã„â€˜Ã¡Â»Â£t nhÃ¡Â»Â hÃ†Â¡n.')
        if not incoming:
            if preview:
                result = build_sheet_preview([], header_row, col, raw, session_id, spreadsheet_url, sheet_tab, header_index + 2)
                result['sessionId'] = session_id or ''
                result['timestamp'] = ts_vn
                result['warnings'].append('KhÃƒÂ´ng cÃƒÂ³ hÃ¡Â»â€œ sÃ†Â¡ hÃ¡Â»Â£p lÃ¡Â»â€¡ nÃƒÂ o trong tab Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân.')
                return result
            if not preview:
                update_state({'status': 'success', 'error': None})
            return {
                'success': True,
                'message': 'KhÃƒÂ´ng cÃƒÂ³ hÃ¡Â»â€œ sÃ†Â¡ hÃ¡Â»Â£p lÃ¡Â»â€¡ nÃƒÂ o trong tÃ¡Â»â€¡p.',
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn
            }

        if preview:
            result = build_sheet_preview(incoming, header_row, col, raw, session_id, spreadsheet_url, sheet_tab, header_index + 2)
            result['sessionId'] = session_id or ''
            result['timestamp'] = ts_vn
            return result
            
        # Perform Sync
        existing = list(Candidate.objects.all())
        existing_codes_set = {candidate.code for candidate in existing}
        created = 0
        updated = 0
        linked_existing = 0
        for cand in incoming:
            candidate_assessments = []
            for candidate in existing:
                assessment = candidate_match_assessment({
                    'name': candidate.name, 'birth_date': candidate.birth_date, 'identity': candidate.identity,
                    'email': candidate.email, 'phone': candidate.phone, 'school': candidate.school,
                    'class_name': candidate.class_name, 'city': candidate.city, 'ward': candidate.ward, 'address': candidate.address,
                }, cand)
                if assessment:
                    candidate_assessments.append((candidate, assessment))
            confirmed = [(candidate, assessment) for candidate, assessment in candidate_assessments if assessment['status'] == 'confirmed']
            matched, matched_assessment = confirmed[0] if len(confirmed) == 1 else (None, None)
            same_code = next((candidate for candidate in existing if cand['code'] and candidate.code.upper() == cand['code'].upper()), None)
            base = matched or same_code
            if base:
                before_values = {field: getattr(base, field) for field in ('name', 'birth_date', 'identity', 'email', 'phone', 'school', 'class_name', 'city', 'ward', 'nationality', 'grade', 'address', 'achievement', 'highest_round', 'parent')}
                previous_session_ids = list(base.session_ids or [])
                already_in_target_session = session_id in previous_session_ids or CandidateParticipation.objects.filter(candidate=base, session_id=session_id).exists()
                base.name = cand['name']
                for field, key in [('birth_date', 'birth_date'), ('identity', 'identity'), ('email', 'email'), ('phone', 'phone'), ('school', 'school'), ('class_name', 'class_name'), ('city', 'city'), ('ward', 'ward'), ('nationality', 'nationality'), ('grade', 'grade'), ('address', 'address'), ('achievement', 'achievement'), ('highest_round', 'highest_round')]:
                    if cand[key] and (field != 'birth_date' or should_replace_birth_date(base.birth_date, cand[key])):
                        setattr(base, field, cand[key])
                if cand['parent']:
                    base.parent = cand['parent']
                base.contests = merge_contest_codes(base.contests, cand['contests'])
                linked_sessions = list(base.session_ids or [])
                if session_id and session_id not in linked_sessions:
                    linked_sessions.append(session_id)
                base.session_ids = linked_sessions
                base.updated = ts_vn
                base.sort_key = f"{base.name.lower()}_{base.identity or base.id}"
                base.save()
                upsert_participation_history(base, session_id, cand['exam_history'], spreadsheet_url, cand['registration'])
                if matched:
                    labels = {
                        'name': 'hÃ¡Â»Â tÃƒÂªn', 'birth_date': 'ngÃƒÂ y sinh', 'identity': 'CCCD/HÃ¡Â»â„¢ chiÃ¡ÂºÂ¿u', 'email': 'email',
                        'phone': 'sÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', 'school': 'trÃ†Â°Ã¡Â»Âng', 'class_name': 'lÃ¡Â»â€ºp', 'city': 'tÃ¡Â»â€°nh/thÃƒÂ nh phÃ¡Â»â€˜',
                        'ward': 'xÃƒÂ£/phÃ†Â°Ã¡Â»Âng', 'nationality': 'quÃ¡Â»â€˜c tÃ¡Â»â€¹ch', 'grade': 'khÃ¡Â»â€˜i lÃ¡Â»â€ºp', 'address': 'Ã„â€˜Ã¡Â»â€¹a chÃ¡Â»â€°',
                        'achievement': 'thÃƒÂ nh tÃƒÂ­ch', 'highest_round': 'vÃƒÂ²ng cao nhÃ¡ÂºÂ¥t', 'parent': 'phÃ¡Â»Â¥ huynh',
                    }
                    changes = [
                        f'Ã„ÂÃƒÂ£ cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t {labels[field]} tÃ¡Â»Â« "{before_values[field] or "chÃ†Â°a cÃƒÂ³ thÃƒÂ´ng tin"}" thÃƒÂ nh "{getattr(base, field) or "chÃ†Â°a cÃƒÂ³ thÃƒÂ´ng tin"}".'
                        for field in labels if before_values[field] != getattr(base, field)
                    ]
                    if changes:
                        LogNote.objects.create(
                            key=f'candidate-{base.code}:import-update:{uuid.uuid4().hex}',
                            entity_key=f'candidate-{base.code}',
                            content=f'HÃ¡Â»â€¡ thÃ¡Â»â€˜ng tÃ¡Â»Â± nhÃ¡ÂºÂ­n diÃ¡Â»â€¡n hÃ¡Â»â€œ sÃ†Â¡ trÃƒÂ¹ng theo {matched_assessment["reason"]}.\n' + '\n'.join(changes),
                            updated_by='HÃ¡Â»â€¡ thÃ¡Â»â€˜ng FT Workspace', system=True,
                        )
                if not already_in_target_session:
                    linked_existing += 1
                    append_existing_candidate_link_note(base, session_id, previous_session_ids)
                updated += 1
                continue

            code = cand['code'].replace('/', '-').replace('?', '-').replace('#', '-').strip().upper() if cand['code'] else ''
            if not code or code in existing_codes_set:
                code = next_code(existing_codes_set)
            new_candidate = Candidate.objects.create(
                id=code, code=code, name=cand['name'], school=cand['school'], class_name=cand['class_name'], city=cand['city'], ward=cand['ward'],
                nationality=cand['nationality'], grade=cand['grade'], contests=cand['contests'], achievement=cand['achievement'], highest_round=cand['highest_round'],
                email=cand['email'], parent=cand['parent'], phone=cand['phone'], identity=cand['identity'], address=cand['address'], birth_date=cand['birth_date'],
                session_ids=[session_id] if session_id else [], updated=ts_vn, sort_key=f"{cand['name'].lower()}_{cand['identity'] or code}",
            )
            upsert_participation_history(new_candidate, session_id, cand['exam_history'], spreadsheet_url, cand['registration'])
            existing.append(new_candidate)
            existing_codes_set.add(code)
            created += 1
        sync_session_candidate_totals()
        update_state({'status': 'success', 'error': None})
        
        return {
            'success': True,
            'message': f"Ã„ÂÃ¡Â»â€œng bÃ¡Â»â„¢ thÃƒÂ nh cÃƒÂ´ng Ã¢â‚¬â€œ ThÃƒÂªm mÃ¡Â»â€ºi: {created}, CÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t: {updated}, HÃ¡Â»â€œ sÃ†Â¡ Ã„â€˜ÃƒÂ£ cÃƒÂ³ Ã„â€˜Ã†Â°Ã¡Â»Â£c bÃ¡Â»â€¢ sung kÃ¡Â»Â³ tÃ¡Â»â€¢ chÃ¡Â»Â©c: {linked_existing}, TÃ¡Â»â€¢ng: {len(incoming)}",
            'created': created,
            'updated': updated,
            'linkedExisting': linked_existing,
            'total': len(incoming),
            'timestamp': ts_vn
        }
    except Exception as e:
        msg = str(e)
        if not preview:
            update_state({'status': 'failed', 'error': msg})
        return {
            'success': False,
            'message': f"LÃ¡Â»â€”i: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }

def sync_examination_from_google_sheet(spreadsheet_url=None, session_id=None, sheet_doc_id=None, sheet_tab=''):
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
        result = sync_single_sheet(spreadsheet_url, ts_vn, sheet_doc_id, session_id, sheet_tab=sheet_tab)
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
        # The global sync is an input operation. Output/summary Sheets are
        # imported only through the explicit manual review flow.
        sheets = list(ExaminationSheet.objects.filter(stage='registration-source'))
        if not sheets:
            return {
                'success': False,
                'message': 'ChÃ†Â°a cÃƒÂ³ tab nguÃ¡Â»â€œn nÃƒÂ o Ã„â€˜Ã†Â°Ã¡Â»Â£c cÃ¡ÂºÂ¥u hÃƒÂ¬nh.',
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn,
            }

        unassigned = [sheet.name for sheet in sheets if not sheet.session_id]
        if unassigned:
            return {
                'success': False,
                'message': 'CÃƒÂ³ tab nguÃ¡Â»â€œn chÃ†Â°a Ã„â€˜Ã†Â°Ã¡Â»Â£c gÃ¡ÂºÂ¯n vÃ¡Â»â€ºi kÃ¡Â»Â³ tÃ¡Â»â€¢ chÃ¡Â»Â©c: ' + ', '.join(unassigned),
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
            
            res = sync_single_sheet(sheet.url, ts_vn, sheet.id, sheet.session_id or None, sheet_tab=sheet.sheet_tab)
            if res['success']:
                total_created += res['created']
                total_updated += res['updated']
                total_candidates += res['total']
                success_count += 1
            else:
                error_messages.append(f"{sheet.name}: {res['message']}")
                
        status_text = f"Ã„ÂÃƒÂ£ Ã„â€˜Ã¡Â»â€œng bÃ¡Â»â„¢ {success_count}/{len(sheets)} nguÃ¡Â»â€œn dÃ¡Â»Â¯ liÃ¡Â»â€¡u. (TÃ¡Â»â€¢ng thÃƒÂªm mÃ¡Â»â€ºi: {total_created}, CÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t: {total_updated})"
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
            'message': f"LÃ¡Â»â€”i: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }
