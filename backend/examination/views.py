from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status
import uuid
import json
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
    next_code,
    export_session_to_google_sheet
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

def ensure_examination_seed():
    repair_legacy_seed_text()
    if ExamSession.objects.exists():
        return
        
    for comp_data in EXAMINATION_SEED['competitions']:
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
        
    for sess_data in EXAMINATION_SEED['sessions']:
        ExamSession.objects.get_or_create(
            id=sess_data['id'],
            defaults={
                'competition_id': sess_data['id'],
                'code': sess_data['code'],
                'name': sess_data['name'],
                'parent': sess_data['parent'],
                'organizer': sess_data['organizer'],
                'time': sess_data['time'],
                'candidates_count': sess_data['candidates_count'],
                'national': sess_data.get('national'),
                'national_date': sess_data.get('national_date'),
                'international': sess_data.get('international'),
                'international_date': sess_data.get('international_date'),
                'phase': sess_data['phase'],
                'note': sess_data['note'],
                'sort_key': f"{sess_data['code'].lower()}_{sess_data['id']}"
            }
        )
        
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
    return {
        'id': sess.id,
        'competitionId': sess.competition_id,
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
            'candidates': candidates
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
    return Response(serialize_competition(comp), status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def competition_detail(request, pk):
    try:
        comp = Competition.objects.get(id=pk)
    except Competition.DoesNotExist:
        return Response({'error': 'Không tìm thấy cuộc thi.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
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
            s.parent = comp.parent
            s.organizer = comp.organizer
            s.save()
            
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
                    'date': r.get('date') or timing.get('date')
                })
                
    time_str = f"{national.get('label', '')} · {international.get('label', '')}".strip()
    sess = ExamSession.objects.create(
        id=sess_id,
        competition_id=comp.id,
        code=comp.code,
        name=name,
        parent=comp.parent,
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
    return Response(serialize_session(sess), status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def session_detail(request, pk):
    try:
        sess = ExamSession.objects.get(id=pk)
    except ExamSession.DoesNotExist:
        return Response({'error': 'Không tìm thấy kỳ tổ chức.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
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
                    'date': r.get('date') or timing.get('date')
                    })
            sess.rounds = processed_rounds
            
        if 'competitionId' in data and data['competitionId'] and data['competitionId'] != sess.competition_id:
            try:
                comp = Competition.objects.get(id=data['competitionId'])
                sess.competition_id = comp.id
                sess.code = comp.code
                sess.parent = comp.parent
                sess.organizer = comp.organizer
                sess.sort_key = f"{comp.code.lower()}_{sess.id}"
            except Competition.DoesNotExist:
                return Response({'error': 'Không tìm thấy cuộc thi được chọn.'}, status=status.HTTP_404_NOT_FOUND)
                
        sess.time = f"{sess.national or ''} · {sess.international or ''}".strip()
        sess.save()
        
        sync_session_candidate_totals()
        sess.refresh_from_db()
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
        data = request.data or {}
        
        fields = ['name', 'school', 'className', 'city', 'ward', 'nationality', 'grade', 'contests', 'achievement', 'highestRound', 'email', 'parent', 'phone', 'identity', 'address', 'birthDate']
        for field in fields:
            if field in data:
                val = str(data[field]).strip()
                if field == 'name': cand.name = val
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
                elif field == 'parent': cand.parent = val
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
        return Response(serialize_candidate(cand))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
            
        cand.delete()
        sync_session_candidate_totals()
        return Response({'success': True})

@api_view(['PUT'])
@permission_classes([IsManagerOrAdmin])
def round_result_detail(request, pk):
    try:
        item = RoundResult.objects.select_related('participation__candidate').get(id=pk)
    except RoundResult.DoesNotExist:
        return Response({'error': 'Không tìm thấy dữ liệu vòng thi.'}, status=status.HTTP_404_NOT_FOUND)

    data = request.data or {}
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

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def import_candidates(request):
    try:
        data = request.data or {}
        input_records = data.get('records', [])
        source = data.get('source', '')
        session_id = str(data.get('sessionId') or '').strip()
        
        if not input_records:
            return Response({'error': 'Không có hồ sơ để nhập.'}, status=status.HTTP_400_BAD_REQUEST)

        ensure_examination_seed()
        if not session_id:
            return Response({'error': 'Chọn kỳ tổ chức trước khi nhập dữ liệu.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ExamSession.objects.get(id=session_id)
        except ExamSession.DoesNotExist:
            return Response({'error': 'Không tìm thấy kỳ tổ chức đã chọn.'}, status=status.HTTP_404_NOT_FOUND)

        if len(input_records) > 1000:
            return Response({'error': 'Mỗi lần chỉ được nhập tối đa 1.000 hồ sơ.'}, status=status.HTTP_400_BAD_REQUEST)
        
        existing = list(Candidate.objects.all())
        existing_codes_set = {c.code for c in existing}
        
        created = 0
        updated = 0
        items_returned = []
        
        for idx, rec in enumerate(input_records):
            # Clean records
            rec_code = str(rec.get('code', '')).replace('/', '-').replace('?', '-').replace('#', '-').strip().upper()
            rec_name = str(rec.get('name', '')).strip()
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
                'contests': str(rec.get('contests', '')).strip(),
                'achievement': str(rec.get('achievement', '')).strip(),
                'highest_round': str(rec.get('highestRound', '')).strip(),
                'email': str(rec.get('email', '')).strip(),
                'parent': str(rec.get('parent', '')).strip(),
                'phone': str(rec.get('phone', '')).strip(),
                'identity': str(rec.get('identity', '')).strip(),
                'address': str(rec.get('address', '')).strip(),
                'birth_date': str(rec.get('birthDate', '')).strip(),
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
                if same_candidate(e_dict, rec_cand):
                    matched = e
                    break
                    
            same_code_cand = None
            if rec_code:
                same_code_cand = next((e for e in existing if e.code.upper() == rec_code), None)
                
            base = matched or same_code_cand
            code = matched.code if matched else (rec_code if (rec_code and rec_code not in existing_codes_set) else next_code(existing_codes_set, idx))
            
            ts_vn = timezone.now().strftime('%d/%m/%Y %H:%M')
            
            if base:
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
                if rec_cand['birth_date']: base.birth_date = rec_cand['birth_date']
                
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
        return Response({'created': created, 'updated': updated, 'items': items_returned})
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
