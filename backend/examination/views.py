from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status
import uuid
import json
import re
from django.utils import timezone
from .models import Competition, ExamSession, Candidate, CandidateParticipation, RoundResult, LogNote, ExaminationSheet
from authentication.models import SystemConfig
from authentication.permissions import IsAuthenticated, IsManagerOrAdmin, IsAdmin
from .sync import (
    sync_session_candidate_totals,
    sync_examination_from_google_sheet,
    get_contest_codes,
    merge_contest_codes,
    same_candidate,
    candidate_match_assessment,
    should_replace_birth_date,
    next_code,
    parse_dob,
    format_person_name,
    export_session_to_google_sheet
)


def audit_actor(request):
    """Return the authenticated actor whenever a person initiated the change."""
    return getattr(request.user, 'email', '') or getattr(request, 'user_email', '') or 'Nhân viên FT Workspace'


def describe_rounds(rounds):
    """Turn stored round JSON into a concise Vietnamese audit description."""
    if not isinstance(rounds, list):
        return ''
    descriptions = []
    for round_config in rounds:
        if not isinstance(round_config, dict):
            continue
        name = str(round_config.get('name') or '').strip()
        if not name:
            continue
        timing = str(round_config.get('label') or round_config.get('date') or '').strip()
        descriptions.append(f'{name} ({timing})' if timing else f'{name} (chưa có thời gian)')
    return '; '.join(descriptions)


def describe_registration(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return str(value or '').strip()
    if not isinstance(value, dict):
        return ''
    labels = {
        'subject': 'Môn thi', 'category': 'Bảng thi', 'registrationMethod': 'Hình thức đăng ký',
        'registrationUnit': 'Đơn vị đăng ký', 'teamName': 'Tên đội', 'examLanguage': 'Ngôn ngữ thi',
        'generalNote': 'Ghi chú', 'certificateLink': 'Link chứng nhận',
    }
    details = [f'{labels.get(key, key)}: {str(item).strip()}' for key, item in value.items() if str(item or '').strip()]
    return '; '.join(details)


def audit_display_value(field, value):
    if field == 'rounds':
        return describe_rounds(value) or 'chưa có vòng thi'
    if field == 'registration':
        return describe_registration(value) or 'chưa có thông tin'
    return str(value or '').strip() or 'chưa có thông tin'


def audit_values(before, after, labels):
    """Build concise, natural-language audit sentences for changed fields."""
    changes = []
    for field, label in labels.items():
        old_value = audit_display_value(field, before.get(field))
        new_value = audit_display_value(field, after.get(field))
        if old_value == new_value:
            continue
        if old_value == 'chưa có thông tin' or old_value == 'chưa có vòng thi':
            changes.append(f'Đã bổ sung {label}: {new_value}.')
        elif new_value == 'chưa có thông tin' or new_value == 'chưa có vòng thi':
            changes.append(f'Đã xóa {label} (trước đó: {old_value}).')
        else:
            changes.append(f'Đã đổi {label} từ "{old_value}" thành "{new_value}".')
    return '\n'.join(changes)


def append_audit(entity_key, content, request=None, system=False, actor=''):
    """Persist an immutable audit note under the detail page which owns the data."""
    if not content:
        return
    LogNote.objects.create(
        key=f'{entity_key}:{uuid.uuid4().hex}',
        entity_key=entity_key,
        content=content,
        updated_by=actor or (audit_actor(request) if request and not system else 'Hệ thống FT Workspace'),
        system=system,
    )


EXAMINATION_SEED = {
    'competitions': [
        { 'id': 'aysbc', 'code': 'AYSBC', 'name': 'Huy hiệu các Nhà khoa học trẻ Châu Á', 'parent': 'AYSBC', 'organizer': 'SCS và META Knowledge' },
        { 'id': 'imo', 'code': 'SIMO', 'name': 'International Maths Olympiad', 'parent': 'SCO - IMO', 'organizer': 'SCO' },
        { 'id': 'ieo', 'code': 'SIEO', 'name': 'International English Olympiad', 'parent': 'SCO - IEO', 'organizer': 'SCO' },
        { 'id': 'iso', 'code': 'SISO', 'name': 'International Science Olympiad', 'parent': 'SCO - ISO', 'organizer': 'SCO' },
        { 'id': 'fimo', 'code': 'FIMO', 'name': 'FermatTech International Mathematics Olympiad', 'parent': 'FIMO', 'organizer': 'FermatTech' },
        { 'id': 'fieo', 'code': 'FIEO', 'name': 'FermatTech International English Olympiad', 'parent': 'FIEO - Tiếng Anh', 'organizer': 'FermatTech' },
    ],
    'sessions': [
        { 'id': 'aysbc', 'code': 'AYSBC', 'name': 'Huy hiệu các Nhà khoa học trẻ Châu Á', 'parent': 'AYSBC', 'organizer': 'SCS và META Knowledge', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'imo', 'code': 'SIMO', 'name': 'International Maths Olympiad', 'parent': 'SCO - IMO', 'organizer': 'SCO', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'ieo', 'code': 'SIEO', 'name': 'International English Olympiad', 'parent': 'SCO - IEO', 'organizer': 'SCO', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'iso', 'code': 'SISO', 'name': 'International Science Olympiad', 'parent': 'SCO - ISO', 'organizer': 'SCO', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'fimo', 'code': 'FIMO', 'name': 'FermatTech International Mathematics Olympiad', 'parent': 'FIMO', 'organizer': 'FermatTech', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'fieo', 'code': 'FIEO', 'name': 'FermatTech International English Olympiad', 'parent': 'FIEO - Tiếng Anh', 'organizer': 'FermatTech', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
    ],
    'candidates': [],
}

LEGACY_SEED_TEXT_CORRECTIONS = {
    'Huy hi\u003fu c\u003fc Nh\u003f khoa h\u003fc tr\u003f Ch\u003fu \u003f': 'Huy hiệu các Nhà khoa học trẻ Châu Á',
    'SCS v\u003f META Knowledge': 'SCS và META Knowledge',
    'FIEO - Ti\u003fng Anh': 'FIEO - Tiếng Anh',
    'Ch\u003fa c\u003fp nh\u003ft': 'Chưa cập nhật',
}

def repair_legacy_seed_text():
    for model, fields in (
        (Competition, ('name', 'parent', 'organizer')),
        (ExamSession, ('name', 'parent', 'organizer', 'phase')),
    ):
        for field in fields:
            for old, new in LEGACY_SEED_TEXT_CORRECTIONS.items():
                model.objects.filter(**{field: old}).update(**{field: new})

def default_session_rounds(session):
    """Provide the common editable round structure for legacy blank sessions."""
    return [
        {'id': 'round-national', 'name': 'Vòng loại Quốc gia', 'label': '', 'date': '', 'slots': []},
        {
            'id': 'round-final',
            'name': 'Vòng Chung kết Quốc gia',
            'label': str(session.national or '').strip(),
            'date': str(session.national_date or '').strip(),
            'slots': [],
        },
        {
            'id': 'round-international',
            'name': 'Vòng Quốc tế',
            'label': str(session.international or '').strip(),
            'date': str(session.international_date or '').strip(),
            'slots': [],
        },
    ]


def ensure_existing_session_rounds():
    """Backfill only legacy sessions that have no usable round configuration."""
    for session in ExamSession.objects.all().only('id', 'rounds', 'national', 'national_date', 'international', 'international_date'):
        configured = [
            round_config for round_config in (session.rounds or [])
            if isinstance(round_config, dict) and str(round_config.get('name') or '').strip()
        ]
        if configured:
            continue
        session.rounds = default_session_rounds(session)
        session.save(update_fields=['rounds', 'updated_at'])


def session_competition(session):
    """Resolve a session to its canonical competition and repair legacy links."""
    competition = Competition.objects.filter(id=session.competition_id).first()
    if not competition:
        candidates = list(Competition.objects.filter(code__iexact=str(session.code or '').strip()))
        if len(candidates) == 1:
            competition = candidates[0]
    if not competition:
        return None

    updates = []
    if session.competition_id != competition.id:
        session.competition_id = competition.id
        updates.append('competition_id')
    if session.code != competition.code:
        session.code = competition.code
        updates.append('code')
    # `parent` was used inconsistently by legacy session records. For a session,
    # it is the human-readable competition name shown across list, edit and import.
    if session.parent != competition.name:
        session.parent = competition.name
        updates.append('parent')
    if session.organizer != competition.organizer:
        session.organizer = competition.organizer
        updates.append('organizer')
    expected_sort_key = f"{competition.code.lower()}_{session.id}"
    if session.sort_key != expected_sort_key:
        session.sort_key = expected_sort_key
        updates.append('sort_key')
    if updates:
        session.save(update_fields=updates + ['updated_at'])
    return competition


def normalize_session_competition_links():
    """Repair historic sessions so every screen reads competition data consistently."""
    for session in ExamSession.objects.all():
        session_competition(session)


def ensure_examination_seed():
    repair_legacy_seed_text()
    # Competitions must exist even when an older database already has sessions.
    for comp_data in EXAMINATION_SEED['competitions']:
        # A user-created competition with the same code is already canonical;
        # do not add a duplicate seed record with a second identity.
        if Competition.objects.filter(code__iexact=comp_data['code']).exists():
            continue
        Competition.objects.get_or_create(
            id=comp_data['id'],
            defaults={
                'code': comp_data['code'],
                'name': comp_data['name'],
                'parent': comp_data['parent'],
                'organizer': comp_data['organizer'],
                'sort_key': f"{comp_data['code'].lower()}_{comp_data['id']}"
            }
        )

    if ExamSession.objects.exists():
        normalize_session_competition_links()
        ensure_existing_session_rounds()
        return

    for sess_data in EXAMINATION_SEED['sessions']:
        comp = Competition.objects.filter(id=sess_data['id']).first() or Competition.objects.get(code__iexact=sess_data['code'])
        ExamSession.objects.get_or_create(
            id=sess_data['id'],
            defaults={
                'competition_id': comp.id,
                'code': comp.code,
                'name': sess_data['name'],
                'parent': comp.name,
                'organizer': comp.organizer,
                'time': sess_data['time'],
                'candidates_count': 0,
                'national': sess_data.get('national'),
                'national_date': sess_data.get('national_date'),
                'international': sess_data.get('international'),
                'international_date': sess_data.get('international_date'),
                'phase': sess_data['phase'],
                'note': sess_data['note'],
                'sort_key': f"{comp.code.lower()}_{sess_data['id']}"
            }
        )

    normalize_session_competition_links()
    ensure_existing_session_rounds()

    for cand_data in EXAMINATION_SEED['candidates']:
        Candidate.objects.get_or_create(
            id=cand_data['id'],
            defaults={
                'code': cand_data['code'],
                'name': cand_data['name'],
                'school': cand_data['school'],
                'class_name': cand_data['class_name'],
                'city': cand_data['city'],
                'contests': cand_data['contests'],
                'achievement': cand_data['achievement'],
                'updated': cand_data['updated'],
                'email': cand_data['email'],
                'parent': cand_data['parent'],
                'phone': cand_data['phone'],
                'identity': cand_data['identity'],
                'address': cand_data['address'],
                'sort_key': f"{cand_data['name'].lower()}_{cand_data['identity'] or cand_data['id']}"
            }
        )
def merge_exam_history(existing, incoming, session_id='', source=''):
    rows = [item for item in (existing or []) if isinstance(item, dict)]
    index = {}
    for position, item in enumerate(rows):
        key = (str(item.get('sessionId') or ''), str(item.get('round') or ''), str(item.get('sbd') or ''))
        index[key] = position
    for item in incoming or []:
        if not isinstance(item, dict):
            continue
        clean = {str(key): str(value).strip() for key, value in item.items() if value not in (None, '')}
        if not clean:
            continue
        clean['sessionId'] = session_id or clean.get('sessionId', '')
        if source:
            clean['source'] = source
        key = (clean.get('sessionId', ''), clean.get('round', ''), clean.get('sbd', ''))
        if key in index:
            rows[index[key]].update(clean)
        else:
            index[key] = len(rows)
            rows.append(clean)
    return rows

ROUND_FIELD_MAP = {
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


def upsert_participation_history(candidate, session_id, history, source='', registration=None):
    """Store a source tab as one session and each populated round independently."""
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
        value = str(registration.get(payload_field) or '').strip()
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
        round_name = str(item.get('round') or '').strip()
        if not round_name:
            continue
        values = {
            model_field: str(item.get(payload_field) or '').strip()
            for payload_field, model_field in ROUND_FIELD_MAP.items()
        }
        if values.get('exam_date'):
            values['exam_date'] = parse_dob(values['exam_date']) or values['exam_date']
        values['raw_data'] = {str(key): value for key, value in item.items() if value not in (None, '')}
        existing_result = RoundResult.objects.filter(participation=participation, round_name=round_name).first()
        if existing_result:
            for model_field in ROUND_FIELD_MAP.values():
                if not values.get(model_field):
                    values[model_field] = getattr(existing_result, model_field)
        RoundResult.objects.update_or_create(
            participation=participation,
            round_name=round_name,
            defaults=values,
        )
    # A new registration always enters the first configured round so it is visible and manageable in the round roster.
    if not participation.round_results.exists():
        first_round = next((str(item.get('name') or '').strip() for item in (session.rounds or []) if isinstance(item, dict) and item.get('name')), 'Vòng 1')
        RoundResult.objects.get_or_create(participation=participation, round_name=first_round)
    return participation


def normalized_exam_history(candidate):
    rows = []
    participations = CandidateParticipation.objects.filter(candidate=candidate).select_related('session').prefetch_related('round_results')
    for participation in participations:
        for result in participation.round_results.all():
            rows.append({
            'sessionId': participation.session_id,
                'sessionCode': participation.session.code,
                'round': result.round_name,
                'eligibility': result.eligibility,
                'sbd': result.sbd,
                'date': result.exam_date,
                'time': result.time_slot,
                'mode': result.mode,
                'location': result.location,
                'link': result.link,
                'account': result.account,
                'password': result.password,
                'attendance': result.attendance,
                'score': result.score,
                'scoreRate': result.score_rate,
                'rank': result.rank,
                'result': result.result,
                'note': result.note,
            })
    return rows


def serialize_competition(comp):
    return {
        'id': comp.id,
        'code': comp.code,
        'name': comp.name,
        'parent': comp.parent,
        'organizer': comp.organizer,
        'sortKey': comp.sort_key,
        'createdBy': comp.created_by,
        'updatedAt': comp.updated_at.isoformat()
    }

def serialize_session(sess):
    competition = session_competition(sess)
    return {
        'id': sess.id,
        'competitionId': sess.competition_id,
        'competitionName': competition.name if competition else sess.parent,
        'code': sess.code,
        'name': sess.name,
        'parent': sess.parent,
        'organizer': sess.organizer,
        'time': sess.time,
        'candidates': sess.candidates_count,
        'national': sess.national,
        'nationalDate': sess.national_date,
        'international': sess.international,
        'internationalDate': sess.international_date,
        'phase': sess.phase,
        'note': sess.note,
        'rounds': sess.rounds or [],
        'sortKey': sess.sort_key,
        'createdBy': sess.created_by,
        'updatedAt': sess.updated_at.isoformat()
    }

def serialize_candidate_participations(cand):
    participations = CandidateParticipation.objects.filter(candidate=cand).select_related('session').prefetch_related('round_results')
    rows = []
    for participation in participations:
        rows.append({
            'sessionId': participation.session_id,
            'sessionCode': participation.session.code,
            'sessionName': participation.session.name,
            'sessionTime': participation.session.time,
            'registration': {
                'subject': participation.subject, 'category': participation.category,
                'registrationMethod': participation.registration_method, 'registrationUnit': participation.registration_unit,
                'teamName': participation.team_name, 'examLanguage': participation.exam_language,
                'generalNote': participation.general_note, 'certificateLink': participation.certificate_link,
            },
            'rounds': [{
                'id': str(result.id),
                'round': result.round_name, 'eligibility': result.eligibility, 'sbd': result.sbd,
                'date': result.exam_date, 'time': result.time_slot, 'mode': result.mode,
                'location': result.location, 'link': result.link, 'account': result.account, 'password': result.password,
                'attendance': result.attendance, 'score': result.score, 'scoreRate': result.score_rate,
                'rank': result.rank, 'result': result.result, 'note': result.note,
            } for result in participation.round_results.all()],
        })
    return rows

def serialize_candidate(cand):
    return {
        'id': cand.id,
        'code': cand.code,
        'name': cand.name,
        'school': cand.school or '',
        'className': cand.class_name or '',
        'city': cand.city or '',
        'ward': cand.ward or '',
        'nationality': cand.nationality or '',
        'grade': cand.grade or '',
        'contests': cand.contests or '',
        'achievement': cand.achievement or '',
        'highestRound': cand.highest_round or '',
        'email': cand.email or '',
        'parent': cand.parent or '',
        'phone': cand.phone or '',
        'identity': cand.identity or '',
        'address': cand.address or '',
        'birthDate': cand.birth_date or '',
        'sessionIds': cand.session_ids or [],
        'participations': serialize_candidate_participations(cand),
        'examHistory': normalized_exam_history(cand) or cand.exam_history or [],
        'sortKey': cand.sort_key,
        'updated': cand.updated or ''
    }


def serialize_lognote(note):
    return {
        'id': note.key,
        'time': timezone.localtime(note.created_at).strftime('%d/%m/%Y %H:%M'),
        'createdAt': note.created_at.isoformat(),
        'actor': note.updated_by or 'Nhân viên FT Workspace',
        'content': note.content,
        'system': note.system,
    }

PARTNER_CONFIG_KEY = 'examination_partners'


def normalize_partners(rows):
    normalized, seen = [], set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        partner_id = str(row.get('id') or '').strip()
        school = str(row.get('school') or '').strip()
        if not partner_id or not school or partner_id in seen:
            continue
        seen.add(partner_id)
        counts = []
        for item in row.get('studentCounts') or []:
            if not isinstance(item, dict) or not str(item.get('session') or '').strip():
                continue
            try:
                count = max(0, int(item.get('count') or 0))
            except (TypeError, ValueError):
                count = 0
            counts.append({'session': str(item.get('session')).strip(), 'count': count})
        normalized.append({
            'id': partner_id, 'province': str(row.get('province') or '').strip(), 'ward': str(row.get('ward') or '').strip(),
            'school': school, 'level': str(row.get('level') or '').strip(), 'representative': str(row.get('representative') or '').strip(),
            'phone': str(row.get('phone') or '').strip(), 'email': str(row.get('email') or '').strip().lower(),
            'contests': list(dict.fromkeys(str(item).strip() for item in row.get('contests') or [] if str(item).strip())),
            'studentCounts': counts,
        })
    return normalized


def recover_partners_from_lognotes():
    recovered, marker = {}, '. Thông tin sau: '
    for note in LogNote.objects.filter(entity_key__startswith='partner-').order_by('created_at'):
        content = str(note.content or '')
        if marker not in content:
            continue
        try:
            after = content.split(marker, 1)[1].strip()
            partner = normalize_partners([json.loads(after[:-1] if after.endswith('.') else after)])
        except (TypeError, ValueError, json.JSONDecodeError):
            partner = []
        if partner:
            recovered[partner[0]['id']] = partner[0]
    return list(recovered.values())


def persisted_partners():
    config, _ = SystemConfig.objects.get_or_create(key=PARTNER_CONFIG_KEY)
    partners = normalize_partners((config.data or {}).get('partners'))
    if partners:
        return partners
    recovered = recover_partners_from_lognotes()
    if recovered:
        config.data = {'partners': recovered}
        config.save(update_fields=['data'])
    return recovered


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def partners_detail(request):
    if request.method == 'GET':
        return Response({'partners': persisted_partners()})
    if getattr(request, 'user_role', getattr(request.user, 'role', '')) not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Bạn không có quyền cập nhật đối tác.'}, status=status.HTTP_403_FORBIDDEN)
    partners = normalize_partners((request.data or {}).get('partners'))
    config, _ = SystemConfig.objects.get_or_create(key=PARTNER_CONFIG_KEY)
    config.data = {'partners': partners}
    config.save(update_fields=['data'])
    return Response({'partners': partners})

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def examination_bootstrap(request):
    try:
        ensure_examination_seed()
        sync_session_candidate_totals()
        
        competitions = [serialize_competition(c) for c in Competition.objects.all().order_by('sort_key')[:1000]]
        sessions = [serialize_session(s) for s in ExamSession.objects.all().order_by('sort_key')[:1000]]
        candidates = [serialize_candidate(cand) for cand in Candidate.objects.all().order_by('sort_key')[:1000]]
        
        return Response({
            'competitions': competitions,
            'sessions': sessions,
            'candidates': candidates,
            'partners': persisted_partners()
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_resource_list(request, resource):
    try:
        ensure_examination_seed()
        limit = int(request.query_params.get('limit', 50))
        cursor = request.query_params.get('cursor')
        
        if resource == 'competitions':
            queryset = Competition.objects.all().order_by('sort_key')
            if cursor:
                queryset = queryset.filter(sort_key__gt=cursor)
            items = list(queryset[:limit + 1])
            has_next = len(items) > limit
            items_to_return = items[:limit]
            
            return Response({
                'items': [serialize_competition(c) for c in items_to_return],
                'nextCursor': items_to_return[-1].sort_key if has_next and items_to_return else None
            })
            
        elif resource == 'sessions':
            queryset = ExamSession.objects.all().order_by('sort_key')
            if cursor:
                queryset = queryset.filter(sort_key__gt=cursor)
            items = list(queryset[:limit + 1])
            has_next = len(items) > limit
            items_to_return = items[:limit]
            
            return Response({
                'items': [serialize_session(s) for s in items_to_return],
                'nextCursor': items_to_return[-1].sort_key if has_next and items_to_return else None
            })
            
        elif resource == 'candidates':
            queryset = Candidate.objects.all().order_by('sort_key')
            if cursor:
                queryset = queryset.filter(sort_key__gt=cursor)
            items = list(queryset[:limit + 1])
            has_next = len(items) > limit
            items_to_return = items[:limit]
            
            return Response({
                'items': [serialize_candidate(c) for c in items_to_return],
                'nextCursor': items_to_return[-1].sort_key if has_next and items_to_return else None
            })
            
        else:
            return Response({'error': 'Nguồn dữ liệu không hợp lệ.'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def competition_create(request):
    data = request.data or {}
    code = data.get('code', '').strip().upper()
    name = data.get('name', '').strip()
    organizer = data.get('organizer', '').strip()
    parent = data.get('parent', '').strip()
    
    if not code or not name or not organizer:
        return Response({'error': 'Tên, mã cuộc thi và BTC quốc tế là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        
    comp_id = f"comp-{uuid.uuid4().hex[:10]}"
    comp = Competition.objects.create(
        id=comp_id,
        code=code,
        name=name,
        organizer=organizer,
        parent=parent or code,
        sort_key=f"{code.lower()}_{comp_id}",
        created_by=request.user.email if hasattr(request.user, 'email') else None
    )
    append_audit(f'competition-{comp.id}', 'Tạo cuộc thi: ' + audit_values({}, {'code': comp.code, 'name': comp.name, 'parent': comp.parent, 'organizer': comp.organizer}, {'code':'Mã cuộc thi', 'name':'Tên cuộc thi', 'parent':'Cuộc thi mẹ', 'organizer':'Ban tổ chức quốc tế'}), request)
    return Response(serialize_competition(comp), status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def competition_detail(request, pk):
    try:
        comp = Competition.objects.get(id=pk)
    except Competition.DoesNotExist:
        return Response({'error': 'Không tìm thấy cuộc thi.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        before = {'code': comp.code, 'name': comp.name, 'parent': comp.parent, 'organizer': comp.organizer}
        data = request.data or {}
        if 'code' in data and data['code'].strip():
            comp.code = data['code'].strip().upper()
        if 'name' in data and data['name'].strip():
            comp.name = data['name'].strip()
        if 'organizer' in data and data['organizer'].strip():
            comp.organizer = data['organizer'].strip()
        if 'parent' in data and data['parent'].strip():
            comp.parent = data['parent'].strip()
            
        comp.sort_key = f"{comp.code.lower()}_{comp.id}"
        comp.save()
        
        # Propagate changes to sessions with this competitionId
        sessions = ExamSession.objects.filter(competition_id=comp.id)
        for s in sessions:
            s.code = comp.code
            s.parent = comp.name
            s.organizer = comp.organizer
            s.save()
            append_audit(f'session-{s.id}', f'Hệ thống đồng bộ thông tin cuộc thi {comp.code}: ' + audit_values({}, {'code': s.code, 'parent': s.parent, 'organizer': s.organizer}, {'code':'Mã cuộc thi', 'parent':'Cuộc thi mẹ', 'organizer':'Ban tổ chức quốc tế'}), request, system=True)
            
        change_text = audit_values(before, {'code': comp.code, 'name': comp.name, 'parent': comp.parent, 'organizer': comp.organizer}, {'code':'Mã cuộc thi', 'name':'Tên cuộc thi', 'parent':'Cuộc thi mẹ', 'organizer':'Ban tổ chức quốc tế'})
        append_audit(f'competition-{comp.id}', 'Cập nhật cuộc thi: ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        return Response(serialize_competition(comp))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
        # Check if there are sessions for this competition
        sessions_exist = ExamSession.objects.filter(competition_id=comp.id).exists()
        if sessions_exist:
            return Response({'error': 'Hãy xóa các kỳ tổ chức thuộc cuộc thi trước.'}, status=status.HTTP_400_BAD_REQUEST)
            
        comp.delete()
        return Response({'success': True})

def sync_legacy_round_milestones(session, rounds):
    """Keep legacy summary fields aligned with the named rounds when available."""
    def find_round(*markers):
        matches = [
            round_config for round_config in rounds
            if any(marker in str(round_config.get('name') or '').lower() for marker in markers)
        ]
        return next(
            (round_config for round_config in matches if round_config.get('label') or round_config.get('date')),
            matches[0] if matches else None,
        )

    # The legacy national field historically represents the national final.
    # Prefer it over a qualifying round whenever both are configured.
    national = (
        find_round('chung k\u1ebft qu\u1ed1c gia', 'national final')
        or find_round('qu\u1ed1c gia', 'national')
    )
    international = find_round('qu\u1ed1c t\u1ebf', 'international')
    session.national = str(national.get('label') or '').strip() if national else ''
    session.national_date = str(national.get('date') or '').strip() if national else ''
    session.international = str(international.get('label') or '').strip() if international else ''
    session.international_date = str(international.get('date') or '').strip() if international else ''
@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def session_create(request):
    data = request.data or {}
    competition_id = data.get('competitionId')
    name = data.get('name', '').strip()
    national = data.get('national', {})
    international = data.get('international', {})
    note = data.get('note', '').strip()
    rounds = data.get('rounds', [])
    
    if not competition_id or not name or not national or not international:
        return Response({'error': 'Tên kỳ, cuộc thi và thời gian hai vòng là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        comp = Competition.objects.get(id=competition_id)
    except Competition.DoesNotExist:
        return Response({'error': 'Không tìm thấy cuộc thi.'}, status=status.HTTP_404_NOT_FOUND)
        
    sess_id = f"session-{uuid.uuid4().hex[:10]}"
    
    # Process rounds
    processed_rounds = []
    if isinstance(rounds, list):
        for r in rounds:
            if isinstance(r, dict) and r.get('name'):
                timing = r.get('time') if isinstance(r.get('time'), dict) else {}
                processed_rounds.append({
                    'id': r.get('id') or f"round-{uuid.uuid4().hex[:10]}",
                    'name': str(r['name']).strip(),
                    'label': str(r.get('label') or timing.get('label') or '').strip(),
                    'date': r.get('date') or timing.get('date'),
                    'slots': [{key: str(slot.get(key) or '').strip() for key in ('id', 'date', 'time', 'mode', 'link', 'location', 'note')} for slot in r.get('slots', []) if isinstance(slot, dict)]
                })
                
    round_national = next((item for item in processed_rounds if 'qu\u1ed1c gia' in str(item.get('name') or '').lower() or 'national' in str(item.get('name') or '').lower()), None)
    round_international = next((item for item in processed_rounds if 'qu\u1ed1c t\u1ebf' in str(item.get('name') or '').lower() or 'international' in str(item.get('name') or '').lower()), None)
    if round_national:
        national = round_national
    if round_international:
        international = round_international
    time_str = f"{national.get('label', '')} · {international.get('label', '')}".strip()
    sess = ExamSession.objects.create(
        id=sess_id,
        competition_id=comp.id,
        code=comp.code,
        name=name,
        parent=comp.name,
        organizer=comp.organizer,
        time=time_str,
        candidates_count=0,
        national=national.get('label'),
        national_date=national.get('date'),
        international=international.get('label'),
        international_date=international.get('date'),
        phase='Chuẩn bị',
        note=note or 'Kỳ tổ chức mới tạo.',
        rounds=processed_rounds,
        sort_key=f"{comp.code.lower()}_{sess_id}",
        created_by=request.user.email if hasattr(request.user, 'email') else None
    )
    append_audit(f'session-{sess.id}', 'Tạo kỳ tổ chức: ' + audit_values({}, {'name': sess.name, 'competition': comp.code, 'phase': sess.phase, 'rounds': processed_rounds}, {'name':'Tên kỳ tổ chức', 'competition':'Cuộc thi', 'phase':'Giai đoạn', 'rounds':'Các vòng thi'}), request)
    append_audit(f'competition-{comp.id}', f'Tạo kỳ tổ chức {sess.name}.', request)
    return Response(serialize_session(sess), status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def session_detail(request, pk):
    try:
        sess = ExamSession.objects.get(id=pk)
    except ExamSession.DoesNotExist:
        return Response({'error': 'Không tìm thấy kỳ tổ chức.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        before = {'name': sess.name, 'phase': sess.phase, 'note': sess.note, 'national': sess.national, 'nationalDate': sess.national_date, 'international': sess.international, 'internationalDate': sess.international_date, 'competitionId': sess.competition_id, 'rounds': sess.rounds or []}
        data = request.data or {}
        
        allowed_fields = ['name', 'phase', 'note', 'national', 'nationalDate', 'international', 'internationalDate']
        for field in allowed_fields:
            if field in data:
                val = str(data[field]).strip()
                if field == 'name': sess.name = val
                elif field == 'phase': sess.phase = val
                elif field == 'note': sess.note = val
                elif field == 'national': sess.national = val
                elif field == 'nationalDate': sess.national_date = val
                elif field == 'international': sess.international = val
                elif field == 'internationalDate': sess.international_date = val
                
        if 'rounds' in data and isinstance(data['rounds'], list):
            processed_rounds = []
            for r in data['rounds']:
                if isinstance(r, dict) and r.get('name'):
                    timing = r.get('time') if isinstance(r.get('time'), dict) else {}
                    processed_rounds.append({
                        'id': r.get('id') or f"round-{uuid.uuid4().hex[:10]}",
                        'name': str(r['name']).strip(),
                        'label': str(r.get('label') or timing.get('label') or '').strip(),
                    'date': r.get('date') or timing.get('date'),
                    'slots': [{key: str(slot.get(key) or '').strip() for key in ('id', 'date', 'time', 'mode', 'link', 'location', 'note')} for slot in r.get('slots', []) if isinstance(slot, dict)]
                    })
            sess.rounds = processed_rounds
            sync_legacy_round_milestones(sess, processed_rounds)
            
        if 'competitionId' in data and data['competitionId'] and data['competitionId'] != sess.competition_id:
            try:
                comp = Competition.objects.get(id=data['competitionId'])
                sess.competition_id = comp.id
                sess.code = comp.code
                sess.parent = comp.name
                sess.organizer = comp.organizer
                sess.sort_key = f"{comp.code.lower()}_{sess.id}"
            except Competition.DoesNotExist:
                return Response({'error': 'Không tìm thấy cuộc thi được chọn.'}, status=status.HTTP_404_NOT_FOUND)
                
        sess.time = f"{sess.national or ''} · {sess.international or ''}".strip()
        sess.save()
        
        sync_session_candidate_totals()
        sess.refresh_from_db()
        after = {'name': sess.name, 'phase': sess.phase, 'note': sess.note, 'national': sess.national, 'nationalDate': sess.national_date, 'international': sess.international, 'internationalDate': sess.international_date, 'competitionId': sess.competition_id, 'rounds': sess.rounds or []}
        change_text = audit_values(before, after, {'name':'Tên kỳ tổ chức', 'phase':'Giai đoạn hiện tại', 'note':'Ghi chú', 'national':'Mốc vòng quốc gia', 'nationalDate':'Ngày vòng quốc gia', 'international':'Mốc vòng quốc tế', 'internationalDate':'Ngày vòng quốc tế', 'competitionId':'Cuộc thi', 'rounds':'Thông tin các vòng thi'})
        append_audit(f'session-{sess.id}', 'Cập nhật kỳ tổ chức: ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        return Response(serialize_session(sess))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
            
        # Remove this session from candidate's session_ids
        candidates = Candidate.objects.filter(session_ids__contains=sess.id)
        for c in candidates:
            if sess.id in c.session_ids:
                c.session_ids = [s_id for s_id in c.session_ids if s_id != sess.id]
                c.save()
                
        append_audit(f'session-{sess.id}', f'Xóa kỳ tổ chức {sess.name}.', request)
        sess.delete()
        sync_session_candidate_totals()
        return Response({'success': True})

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def candidate_detail(request, pk):
    try:
        cand = Candidate.objects.get(code=pk)
    except Candidate.DoesNotExist:
        try:
            cand = Candidate.objects.get(id=pk)
        except Candidate.DoesNotExist:
            return Response({'error': 'Không tìm thấy thí sinh.'}, status=status.HTTP_404_NOT_FOUND)
            
    if request.method == 'PUT':
        before = {'name': cand.name, 'school': cand.school, 'className': cand.class_name, 'city': cand.city, 'ward': cand.ward, 'nationality': cand.nationality, 'grade': cand.grade, 'contests': cand.contests, 'achievement': cand.achievement, 'highestRound': cand.highest_round, 'email': cand.email, 'parent': cand.parent, 'phone': cand.phone, 'identity': cand.identity, 'address': cand.address, 'birthDate': cand.birth_date, 'sessionIds': ', '.join(sorted(cand.session_ids or []))}
        data = request.data or {}
        
        fields = ['name', 'school', 'className', 'city', 'ward', 'nationality', 'grade', 'contests', 'achievement', 'highestRound', 'email', 'parent', 'phone', 'identity', 'address', 'birthDate']
        for field in fields:
            if field in data:
                val = str(data[field]).strip()
                if field == 'name': cand.name = format_person_name(val)
                elif field == 'school': cand.school = val
                elif field == 'className': cand.class_name = val
                elif field == 'city': cand.city = val
                elif field == 'ward': cand.ward = val
                elif field == 'nationality': cand.nationality = val
                elif field == 'grade': cand.grade = val
                elif field == 'contests': cand.contests = val
                elif field == 'achievement': cand.achievement = val
                elif field == 'highestRound': cand.highest_round = val
                elif field == 'email': cand.email = val
                elif field == 'parent': cand.parent = format_person_name(val)
                elif field == 'phone': cand.phone = val
                elif field == 'identity': cand.identity = val
                elif field == 'address': cand.address = val
                elif field == 'birthDate': cand.birth_date = val
                
        if 'contests' in data:
            cand.contests = merge_contest_codes(cand.contests)
            
        if 'sessionIds' in data and isinstance(data['sessionIds'], list):
            cand.session_ids = list(set([str(s_id).strip() for s_id in data['sessionIds'] if str(s_id).strip()]))
            
        cand.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
        cand.sort_key = f"{cand.name.lower()}_{cand.identity or cand.id}"
        cand.save()
        
        sync_session_candidate_totals()
        cand.refresh_from_db()
        after = {'name': cand.name, 'school': cand.school, 'className': cand.class_name, 'city': cand.city, 'ward': cand.ward, 'nationality': cand.nationality, 'grade': cand.grade, 'contests': cand.contests, 'achievement': cand.achievement, 'highestRound': cand.highest_round, 'email': cand.email, 'parent': cand.parent, 'phone': cand.phone, 'identity': cand.identity, 'address': cand.address, 'birthDate': cand.birth_date, 'sessionIds': ', '.join(sorted(cand.session_ids or []))}
        labels = {'name':'Họ và tên', 'school':'Trường học', 'className':'Lớp đang học', 'city':'Tỉnh/Thành phố cư trú', 'ward':'Phường/Xã', 'nationality':'Quốc tịch', 'grade':'Khối lớp', 'contests':'Cuộc thi', 'achievement':'Thành tích cao nhất', 'highestRound':'Vòng cao nhất', 'email':'Email', 'parent':'Phụ huynh', 'phone':'Điện thoại', 'identity':'CCCD/Hộ chiếu', 'address':'Địa chỉ', 'birthDate':'Ngày sinh', 'sessionIds':'Các kỳ tổ chức'}
        change_text = audit_values(before, after, labels)
        append_audit(f'candidate-{cand.code}', 'Cập nhật hồ sơ thí sinh: ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        for session_id in set((before.get('sessionIds') or '').split(', ')) | set(cand.session_ids or []):
            if session_id:
                append_audit(f'session-{session_id}', f'Cập nhật hồ sơ thí sinh {cand.code} ({cand.name}): ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        return Response(serialize_candidate(cand))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
            
        for session_id in cand.session_ids or []:
            append_audit(f'session-{session_id}', f'Xóa thí sinh {cand.code} ({cand.name}) khỏi kỳ tổ chức.', request)
        append_audit(f'candidate-{cand.code}', f'Xóa hồ sơ thí sinh {cand.code} ({cand.name}).', request)
        cand.delete()
        sync_session_candidate_totals()
        return Response({'success': True})

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def round_result_detail(request, pk):
    try:
        item = RoundResult.objects.select_related('participation__candidate').get(id=pk)
    except RoundResult.DoesNotExist:
        return Response({'error': 'Không tìm thấy dữ liệu vòng thi.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        candidate = item.participation.candidate
        round_name = item.round_name
        session_id_for_log = item.participation.session_id
        if request.query_params.get('removeFromSession') == '1':
            session_id = item.participation.session_id
            all_sessions = list(ExamSession.objects.all())
            existing_ids = list(candidate.session_ids or [])
            remaining_ids = [value for value in existing_ids if value != session_id]
            if not existing_ids:
                existing_codes = get_contest_codes(candidate.contests)
                remaining_ids = [session.id for session in all_sessions if session.id != session_id and session.code.upper() in existing_codes]
            candidate.session_ids = remaining_ids
            removed_session = next((session for session in all_sessions if session.id == session_id), None)
            remaining_codes = {session.code.upper() for session in all_sessions if session.id in remaining_ids}
            if removed_session and removed_session.code.upper() not in remaining_codes:
                candidate.contests = ', '.join(code for code in get_contest_codes(candidate.contests) if code.upper() != removed_session.code.upper())
            CandidateParticipation.objects.filter(candidate=candidate, session_id=session_id).delete()
        else:
            item.delete()
        candidate.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
        candidate.save()
        action = f'Gỡ thí sinh {candidate.code} ({candidate.name}) khỏi toàn bộ kỳ tổ chức.' if request.query_params.get('removeFromSession') == '1' else f'Gỡ thí sinh {candidate.code} ({candidate.name}) khỏi {round_name}.'
        append_audit(f'candidate-{candidate.code}', action, request)
        append_audit(f'session-{session_id_for_log}', action, request)
        sync_session_candidate_totals()
        return Response({'candidate': serialize_candidate(candidate)})
    data = request.data or {}
    before_round = {'eligibility': item.eligibility, 'sbd': item.sbd, 'date': item.exam_date, 'time': item.time_slot, 'mode': item.mode, 'location': item.location, 'link': item.link, 'account': item.account, 'password': item.password, 'attendance': item.attendance, 'score': item.score, 'scoreRate': item.score_rate, 'rank': item.rank, 'result': item.result, 'note': item.note, 'registration': json.dumps(item.participation.registration_data or {}, ensure_ascii=False)}
    fields = {
        'eligibility': 'eligibility', 'sbd': 'sbd', 'date': 'exam_date', 'time': 'time_slot',
        'mode': 'mode', 'location': 'location', 'link': 'link', 'account': 'account', 'password': 'password',
        'attendance': 'attendance', 'score': 'score', 'scoreRate': 'score_rate',
        'rank': 'rank', 'result': 'result', 'note': 'note',
    }
    for payload_field, model_field in fields.items():
        if payload_field in data:
            setattr(item, model_field, str(data[payload_field] or '').strip())
    registration = data.get('registration') if isinstance(data.get('registration'), dict) else {}
    registration_fields = {
        'subject': 'subject', 'category': 'category', 'registrationMethod': 'registration_method',
        'registrationUnit': 'registration_unit', 'teamName': 'team_name', 'examLanguage': 'exam_language',
        'generalNote': 'general_note', 'certificateLink': 'certificate_link',
    }
    participation_updates = []
    for payload_field, model_field in registration_fields.items():
        if payload_field in registration:
            setattr(item.participation, model_field, str(registration[payload_field] or '').strip())
            participation_updates.append(model_field)
    if registration:
        item.participation.registration_data = {str(key): value for key, value in registration.items() if value not in (None, '')}
        participation_updates.append('registration_data')
    item.save()
    if participation_updates:
        item.participation.save(update_fields=list(set(participation_updates)) + ['updated_at'])
    candidate = item.participation.candidate
    candidate.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
    candidate.save(update_fields=['updated'])
    after_round = {'eligibility': item.eligibility, 'sbd': item.sbd, 'date': item.exam_date, 'time': item.time_slot, 'mode': item.mode, 'location': item.location, 'link': item.link, 'account': item.account, 'password': item.password, 'attendance': item.attendance, 'score': item.score, 'scoreRate': item.score_rate, 'rank': item.rank, 'result': item.result, 'note': item.note, 'registration': json.dumps(item.participation.registration_data or {}, ensure_ascii=False)}
    round_labels = {'eligibility':'Điều kiện', 'sbd':'Số báo danh', 'date':'Ngày thi', 'time':'Giờ/ca thi', 'mode':'Hình thức', 'location':'Địa điểm', 'link':'Link/phòng thi', 'account':'Tài khoản', 'password':'Mật khẩu', 'attendance':'Điểm danh', 'score':'Điểm', 'scoreRate':'Tỷ lệ điểm', 'rank':'Xếp hạng', 'result':'Kết quả', 'note':'Ghi chú', 'registration':'Thông tin đăng ký'}
    change_text = audit_values(before_round, after_round, round_labels)
    audit_content = f'Cập nhật {item.round_name} cho {candidate.code} ({candidate.name}): ' + (change_text or 'Không có thay đổi dữ liệu.')
    append_audit(f'candidate-{candidate.code}', audit_content, request)
    append_audit(f'session-{item.participation.session_id}', audit_content, request)
    return Response({'candidate': serialize_candidate(candidate)})

@api_view(['DELETE'])
@permission_classes([IsAdmin])
def candidate_remove_from_session(request, pk, session_id):
    try:
        cand = Candidate.objects.get(code=pk)
    except Candidate.DoesNotExist:
        try:
            cand = Candidate.objects.get(id=pk)
        except Candidate.DoesNotExist:
            return Response({'error': 'Không tìm thấy thí sinh.'}, status=status.HTTP_404_NOT_FOUND)
            
    all_sessions = list(ExamSession.objects.all())
    derived = list(cand.session_ids) if cand.session_ids else []
    if not cand.session_ids:
        # derive sessions from contests code
        sess_codes = get_contest_codes(cand.contests)
        derived = [s.id for s in all_sessions if s.code.upper() in sess_codes]
        
    cand.session_ids = [s_id for s_id in derived if s_id != session_id]
    CandidateParticipation.objects.filter(candidate=cand, session_id=session_id).delete()
    cand.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
    cand.save()
    action = f'Gỡ thí sinh {cand.code} ({cand.name}) khỏi kỳ tổ chức.'
    append_audit(f'candidate-{cand.code}', action, request)
    append_audit(f'session-{session_id}', action, request)
    
    sync_session_candidate_totals()
    return Response(serialize_candidate(cand))

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def sheets_list(request):
    if request.method == 'GET':
        sheets = ExaminationSheet.objects.all().order_by('-created_at')
        result = []
        for s in sheets:
            result.append({
                'id': s.id,
                'name': s.name,
                'url': s.url,
                'status': s.status,
                'sessionId': s.session_id,
                'sheetTab': s.sheet_tab,
                'stage': s.stage,
                'createdAt': s.created_at.isoformat(),
                'updatedAt': s.updated_at.isoformat(),
                'createdBy': s.created_by
            })
            
        if not result:
            return Response([])

        return Response(result)
        
    elif request.method == 'POST':
        if getattr(request, 'user_role', 'EMPLOYEE') not in ['ADMIN', 'MANAGER']:
            return Response({"error": "Quyền quản trị viên hoặc quản lý là bắt buộc."}, status=status.HTTP_403_FORBIDDEN)
            
        data = request.data or {}
        name = data.get('name', '').strip()
        url = data.get('url', '').strip()
        session_id = str(data.get('sessionId') or '').strip()
        
        if not name or not url:
            return Response({'error': 'Tên nguồn và đường dẫn Google Sheets là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
            
        if not session_id or not ExamSession.objects.filter(id=session_id).exists():
            return Response({'error': 'Mỗi tab nguồn phải được gắn với một kỳ tổ chức hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        sheet = ExaminationSheet.objects.create(
            id=f"sheet-{uuid.uuid4().hex[:10]}",
            name=name,
            url=url,
            status='idle',
            session_id=session_id,
            sheet_tab=data.get('sheetTab', '').strip(),
            stage=data.get('stage', '').strip(),
            created_at=timezone.now(),
            updated_at=timezone.now(),
            created_by=request.user.email if hasattr(request.user, 'email') else None
        )
        return Response({
            'id': sheet.id,
            'name': sheet.name,
            'url': sheet.url,
            'status': sheet.status,
            'sessionId': sheet.session_id,
            'sheetTab': sheet.sheet_tab,
            'stage': sheet.stage,
            'createdAt': sheet.created_at.isoformat(),
            'updatedAt': sheet.updated_at.isoformat(),
            'createdBy': sheet.created_by
        }, status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def sheet_detail(request, pk):
    try:
        sheet = ExaminationSheet.objects.get(id=pk)
    except ExaminationSheet.DoesNotExist:
        return Response({'error': 'Không tìm thấy nguồn sheets.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        data = request.data or {}
        if 'name' in data and data['name'].strip():
            sheet.name = data['name'].strip()
        if 'url' in data and data['url'].strip():
            sheet.url = data['url'].strip()
        if 'sessionId' in data:
            requested_session_id = str(data.get('sessionId') or '').strip()
            if not requested_session_id or not ExamSession.objects.filter(id=requested_session_id).exists():
                return Response({'error': 'Mỗi tab nguồn phải được gắn với một kỳ tổ chức hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
            sheet.session_id = requested_session_id
        if 'sheetTab' in data:
            sheet.sheet_tab = str(data.get('sheetTab') or '').strip()
        if 'stage' in data:
            sheet.stage = str(data.get('stage') or '').strip()
            
        sheet.updated_at = timezone.now()
        sheet.save()
        return Response({
            'id': sheet.id,
            'name': sheet.name,
            'url': sheet.url,
            'status': sheet.status,
            'sessionId': sheet.session_id,
            'sheetTab': sheet.sheet_tab,
            'stage': sheet.stage,
            'createdAt': sheet.created_at.isoformat(),
            'updatedAt': sheet.updated_at.isoformat(),
            'createdBy': sheet.created_by
        })
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
        sheet.delete()
        return Response({'success': True})

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sheet_export(request, pk):
    try:
        sheet = ExaminationSheet.objects.get(id=pk)
    except ExaminationSheet.DoesNotExist:
        return Response({'error': 'Không tìm thấy nguồn dữ liệu.'}, status=status.HTTP_404_NOT_FOUND)
    if not sheet.session_id:
        return Response({'error': 'Nguồn dữ liệu chưa được gắn với kỳ tổ chức.'}, status=status.HTTP_400_BAD_REQUEST)

    sheet.status = 'running'
    sheet.updated_at = timezone.now()
    sheet.save(update_fields=['status', 'updated_at'])
    try:
        result = export_session_to_google_sheet(sheet, getattr(request, 'google_access_token', None))
    except Exception as exc:
        sheet.status = 'failed'
        sheet.updated_at = timezone.now()
        sheet.save(update_fields=['status', 'updated_at'])
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    sheet.status = 'success'
    sheet.updated_at = timezone.now()
    sheet.save(update_fields=['status', 'updated_at'])
    return Response(result)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sheets_sync(request):
    data = request.data or {}
    url = data.get('url', '').strip()
    sheet_id = data.get('id')
    
    target_url = url or None
    session_id = str(data.get('sessionId') or '').strip() or None
    if sheet_id:
        try:
            sheet = ExaminationSheet.objects.get(id=sheet_id)
            target_url = sheet.url
            session_id = sheet.session_id or session_id
        except ExaminationSheet.DoesNotExist:
            return Response({'error': 'Không tìm thấy nguồn dữ liệu.'}, status=status.HTTP_404_NOT_FOUND)

    if target_url and not session_id:
        return Response({'error': 'Nguồn dữ liệu chưa được gắn với kỳ tổ chức.'}, status=status.HTTP_400_BAD_REQUEST)
            
    result = sync_examination_from_google_sheet(target_url, session_id, sheet_id)
    if not result['success']:
        return Response({'error': result['message']}, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_status(request):
    config = SystemConfig.objects.filter(key='examination_sync_state').first()
    return Response(config.data if config and config.data else {'status': 'idle'})

def duplicate_candidate_summary(candidate):
    sessions = list(ExamSession.objects.filter(id__in=list(candidate.session_ids or [])).values('id', 'code', 'name'))
    return {
        'code': candidate.code,
        'name': candidate.name,
        'birthDate': candidate.birth_date or '',
        'identity': candidate.identity or '',
        'email': candidate.email or '',
        'phone': candidate.phone or '',
        'school': candidate.school or '',
        'className': candidate.class_name or '',
        'city': candidate.city or '',
        'ward': candidate.ward or '',
        'address': candidate.address or '',
        'sessions': sessions,
    }

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def import_candidate_duplicates(request):
    """Preview safe identity matches before a spreadsheet is committed."""
    records = (request.data or {}).get('records', [])
    if not isinstance(records, list):
        return Response({'error': 'Danh sách hồ sơ không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(records) > 1000:
        return Response({'error': 'Mỗi lần chỉ được kiểm tra tối đa 1.000 hồ sơ.'}, status=status.HTTP_400_BAD_REQUEST)

    existing = list(Candidate.objects.all())
    duplicates = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        name = format_person_name(record.get('name', ''))
        if not name:
            continue
        raw_code = str(record.get('code') or '').replace('/', '-').replace('?', '-').replace('#', '-').strip().upper()
        supplied_code = '' if raw_code in {'', '-', '—', 'N/A', 'NA'} else raw_code
        incoming = {
            'name': name,
            'birth_date': parse_dob(record.get('birthDate', '')),
            'identity': str(record.get('identity') or '').strip(),
            'email': str(record.get('email') or '').strip(),
            'phone': str(record.get('phone') or '').strip(),
            'school': str(record.get('school') or '').strip(),
            'class_name': str(record.get('className') or '').strip(),
            'city': str(record.get('city') or '').strip(),
            'ward': str(record.get('ward') or '').strip(),
            'address': str(record.get('address') or '').strip(),
        }
        matches = []
        for candidate in existing:
            assessment = candidate_match_assessment({
                'name': candidate.name, 'birth_date': candidate.birth_date, 'identity': candidate.identity,
                'email': candidate.email, 'phone': candidate.phone, 'school': candidate.school,
                'class_name': candidate.class_name,
                'city': candidate.city, 'ward': candidate.ward, 'address': candidate.address,
            }, incoming)
            if assessment:
                matches.append((candidate, assessment))
        if supplied_code:
            coded = next((candidate for candidate in existing if str(candidate.code or '').upper() == supplied_code), None)
            if coded and not any(candidate.id == coded.id for candidate, _ in matches):
                matches.append((coded, {'status': 'confirmed', 'reason': 'Mã hồ sơ'}))
        for matched, assessment in matches:
            duplicates.append({
                'row': index + 1,
                'importedName': name,
                'status': assessment['status'],
                'matchBy': assessment['reason'],
                'existing': duplicate_candidate_summary(matched),
            })
    return Response({'duplicates': duplicates})

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def import_candidates(request):
    try:
        data = request.data or {}
        input_records = data.get('records', [])
        confirmed_matches = data.get('confirmedMatches', {})
        if not isinstance(confirmed_matches, dict):
            confirmed_matches = {}
        source = data.get('source', '')
        session_id = str(data.get('sessionId') or '').strip()
        
        if not input_records:
            return Response({'error': 'Không có hồ sơ để nhập.'}, status=status.HTTP_400_BAD_REQUEST)

        ensure_examination_seed()
        if not session_id:
            return Response({'error': 'Chọn kỳ tổ chức trước khi nhập dữ liệu.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_session = ExamSession.objects.get(id=session_id)
        except ExamSession.DoesNotExist:
            return Response({'error': 'Không tìm thấy kỳ tổ chức đã chọn.'}, status=status.HTTP_404_NOT_FOUND)

        if len(input_records) > 1000:
            return Response({'error': 'Mỗi lần chỉ được nhập tối đa 1.000 hồ sơ.'}, status=status.HTTP_400_BAD_REQUEST)
        
        existing = list(Candidate.objects.all())
        existing_codes_set = {c.code for c in existing}
        
        created = 0
        updated = 0
        linked_existing = 0
        items_returned = []
        
        for idx, rec in enumerate(input_records):
            # Clean records
            raw_code = str(rec.get('code', '')).replace('/', '-').replace('?', '-').replace('#', '-').strip().upper()
            # Blank placeholders in a template are never stored as a profile
            # code. They receive the next FT-00001 style code below; a supplied
            # legacy code remains usable for re-import matching.
            rec_code = '' if raw_code in {'', '-', '—', 'N/A', 'NA'} else raw_code
            rec_name = format_person_name(rec.get('name', ''))
            if not rec_name:
                continue
                
            rec_cand = {
                'code': rec_code,
                'name': rec_name,
                'school': str(rec.get('school', '')).strip(),
                'class_name': str(rec.get('className', '')).strip(),
                'city': str(rec.get('city', '')).strip(),
                'ward': str(rec.get('ward', '')).strip(),
                'nationality': str(rec.get('nationality', '')).strip(),
                'grade': str(rec.get('grade', '')).strip(),
                'contests': merge_contest_codes(str(rec.get('contests', '')).strip(), target_session.code),
                'achievement': str(rec.get('achievement', '')).strip(),
                'highest_round': str(rec.get('highestRound', '')).strip(),
                'email': str(rec.get('email', '')).strip(),
                'parent': format_person_name(rec.get('parent', '')),
                'phone': str(rec.get('phone', '')).strip(),
                'identity': str(rec.get('identity', '')).strip(),
                'address': str(rec.get('address', '')).strip(),
                'birth_date': parse_dob(rec.get('birthDate', '')),
                'registration': {
                    'subject': str(rec.get('subject', '')).strip(),
                    'category': str(rec.get('category', '')).strip(),
                    'registrationMethod': str(rec.get('registrationMethod', '')).strip(),
                    'registrationUnit': str(rec.get('registrationUnit', '')).strip(),
                    'teamName': str(rec.get('teamName', '')).strip(),
                    'examLanguage': str(rec.get('examLanguage', '')).strip(),
                    'generalNote': str(rec.get('generalNote', '')).strip(),
                    'certificateLink': str(rec.get('certificateLink', '')).strip(),
                },

                'exam_history': rec.get('examHistory') or [],
            }
            
            # Automatically link only when the rules yield one unambiguous,
            # confirmed profile. Multiple matches stay separate for safety.
            assessments = []
            for e in existing:
                e_dict = {
                    'name': e.name,
                    'birth_date': e.birth_date,
                    'identity': e.identity,
                    'email': e.email,
                    'phone': e.phone,
                    'school': e.school,
                    'class_name': e.class_name,
                    'city': e.city,
                    'ward': e.ward,
                    'address': e.address,
                }
                assessment = candidate_match_assessment(e_dict, rec_cand)
                if assessment:
                    assessments.append((e, assessment))
            confirmed = [(candidate, assessment) for candidate, assessment in assessments if assessment['status'] == 'confirmed']
            matched, matched_assessment = confirmed[0] if len(confirmed) == 1 else (None, None)

            # A manager can explicitly confirm a row marked "Cần xác nhận" in
            # the preview. The server verifies that the requested profile was
            # actually one of those suspicious matches before linking it.
            forced_candidate = None
            forced_code = str(confirmed_matches.get(str(idx + 1), '') or '').strip().upper()
            if forced_code:
                possible = next(((candidate, assessment) for candidate, assessment in assessments if candidate.code.upper() == forced_code and assessment['status'] == 'possible'), None)
                if possible:
                    forced_candidate, matched_assessment = possible

            same_code_cand = next((e for e in existing if rec_code and e.code.upper() == rec_code), None)
            base = matched or same_code_cand or forced_candidate
            code = base.code if base else (rec_code if (rec_code and rec_code not in existing_codes_set) else next_code(existing_codes_set))
            ts_vn = timezone.now().strftime('%d/%m/%Y %H:%M')
            
            if base:
                before_values = {
                    field: getattr(base, field)
                    for field in ('name', 'birth_date', 'identity', 'email', 'phone', 'school', 'class_name', 'city', 'ward', 'nationality', 'grade', 'address', 'achievement', 'highest_round', 'parent')
                }
                previous_session_ids = list(base.session_ids or [])
                already_in_target_session = session_id in previous_session_ids or CandidateParticipation.objects.filter(candidate=base, session_id=session_id).exists()
                base.name = rec_cand['name']
                if rec_cand['school']: base.school = rec_cand['school']
                if rec_cand['class_name']: base.class_name = rec_cand['class_name']
                if rec_cand['city']: base.city = rec_cand['city']
                if rec_cand['ward']: base.ward = rec_cand['ward']
                if rec_cand['nationality']: base.nationality = rec_cand['nationality']
                if rec_cand['grade']: base.grade = rec_cand['grade']
                if rec_cand['achievement']: base.achievement = rec_cand['achievement']
                if rec_cand['highest_round']: base.highest_round = rec_cand['highest_round']
                if rec_cand['email']: base.email = rec_cand['email']
                if rec_cand['parent']: base.parent = rec_cand['parent']
                if rec_cand['phone']: base.phone = rec_cand['phone']
                if rec_cand['identity']: base.identity = rec_cand['identity']
                if rec_cand['address']: base.address = rec_cand['address']
                if should_replace_birth_date(base.birth_date, rec_cand['birth_date']): base.birth_date = rec_cand['birth_date']

                base.contests = merge_contest_codes(base.contests, rec_cand['contests'])
                if session_id:
                    s_ids = list(base.session_ids) if base.session_ids else []
                    if session_id not in s_ids:
                        s_ids.append(session_id)
                    base.session_ids = s_ids
                base.exam_history = merge_exam_history(base.exam_history, rec_cand['exam_history'], session_id, source)
                base.updated = ts_vn
                base.save()
                upsert_participation_history(base, session_id, rec_cand['exam_history'], source, rec_cand['registration'])

                after_values = {
                    field: getattr(base, field)
                    for field in ('name', 'birth_date', 'identity', 'email', 'phone', 'school', 'class_name', 'city', 'ward', 'nationality', 'grade', 'address', 'achievement', 'highest_round', 'parent')
                }
                changes = audit_values(before_values, after_values, {
                    'name': 'họ tên', 'birth_date': 'ngày sinh', 'identity': 'CCCD/Hộ chiếu',
                    'email': 'email', 'phone': 'số điện thoại', 'school': 'trường', 'class_name': 'lớp',
                    'city': 'tỉnh/thành phố', 'ward': 'xã/phường', 'nationality': 'quốc tịch',
                    'grade': 'khối lớp', 'address': 'địa chỉ', 'achievement': 'thành tích',
                    'highest_round': 'vòng cao nhất', 'parent': 'phụ huynh',
                })
                note_lines = []
                if forced_candidate:
                    note_lines.append(f'Người dùng đã xác nhận hồ sơ nhập là trùng với mã {base.code}.')
                elif matched:
                    note_lines.append(f'Hệ thống tự nhận diện hồ sơ trùng theo {matched_assessment["reason"]}.')
                if changes:
                    note_lines.append(changes)
                if not already_in_target_session:
                    linked_existing += 1
                    previous_sessions = list(ExamSession.objects.filter(id__in=previous_session_ids).exclude(id=session_id).values_list('code', 'name'))
                    previous_label = ', '.join(f'{code} · {name}' for code, name in previous_sessions) or 'chưa có kỳ tổ chức khác được ghi nhận'
                    note_lines.append(f'Đã bổ sung dữ liệu vào kỳ tổ chức {target_session.code} · {target_session.name}. Thí sinh đã từng thi: {previous_label}.')
                if note_lines:
                    append_audit(f'candidate-{base.code}', '\n'.join(note_lines), request, system=not bool(forced_candidate))
                updated += 1
                items_returned.append(serialize_candidate(base))
            else:
                s_ids = [session_id] if session_id else []
                new_c = Candidate.objects.create(
                    id=code,
                    code=code,
                    name=rec_cand['name'],
                    school=rec_cand['school'],
                    class_name=rec_cand['class_name'],
                    city=rec_cand['city'],
                    ward=rec_cand['ward'],
                    nationality=rec_cand['nationality'],
                    grade=rec_cand['grade'],
                    contests=rec_cand['contests'],
                    achievement=rec_cand['achievement'],
                    highest_round=rec_cand['highest_round'],
                    email=rec_cand['email'],
                    parent=rec_cand['parent'],
                    phone=rec_cand['phone'],
                    identity=rec_cand['identity'],
                    address=rec_cand['address'],
                    birth_date=rec_cand['birth_date'],
                    session_ids=s_ids,
                    exam_history=merge_exam_history([], rec_cand['exam_history'], session_id, source),
                    updated=ts_vn,
                    sort_key=f"{rec_cand['name'].lower()}_{rec_cand['identity'] or code}"
                )
                upsert_participation_history(new_c, session_id, rec_cand['exam_history'], source, rec_cand['registration'])
                existing.append(new_c)
                existing_codes_set.add(code)
                created += 1
                items_returned.append(serialize_candidate(new_c))
                
        sync_session_candidate_totals()
        source_label = str(source or 'nguồn nhập dữ liệu').strip()
        existing_summary = f'; trong đó {linked_existing} hồ sơ đã có được bổ sung vào kỳ tổ chức này' if linked_existing else ''
        append_audit(f'session-{session_id}', f'Hệ thống nhập dữ liệu từ {source_label}: thêm {created} thí sinh, cập nhật {updated} thí sinh{existing_summary}.', request, system=True)
        return Response({'created': created, 'updated': updated, 'linkedExisting': linked_existing, 'items': items_returned})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def lognotes_detail(request, entityKey):
    try:
        if request.method == 'GET':
            notes = [
                serialize_lognote(note)
                for note in LogNote.objects.filter(entity_key=entityKey).order_by('-created_at')
            ]
            return Response(notes)

        data = request.data or {}
        content = data.get('content', '').strip()
        actor = data.get('actor', '').strip()
        system = bool(data.get('system', False))
        if not content:
            return Response({'error': 'Nội dung không được để trống.'}, status=status.HTTP_400_BAD_REQUEST)

        note = LogNote.objects.create(
            key=f"{entityKey}:{uuid.uuid4().hex}",
            entity_key=entityKey,
            content=content,
            updated_by=actor or getattr(request.user, 'email', '') or 'Nhân viên FT Workspace',
            system=system,
        )
        return Response({'success': True, 'note': serialize_lognote(note)}, status=status.HTTP_201_CREATED)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
