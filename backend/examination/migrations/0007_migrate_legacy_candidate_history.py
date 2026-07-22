from django.db import migrations


def migrate_legacy_candidate_history(apps, schema_editor):
    Candidate = apps.get_model('examination', 'Candidate')
    ExamSession = apps.get_model('examination', 'ExamSession')
    CandidateParticipation = apps.get_model('examination', 'CandidateParticipation')
    RoundResult = apps.get_model('examination', 'RoundResult')

    sessions = {session.id: session for session in ExamSession.objects.all()}
    sessions_by_code = {}
    for session in sessions.values():
        sessions_by_code.setdefault((session.code or '').strip().upper(), []).append(session.id)

    mapping = {
        'sbd': 'sbd', 'date': 'exam_date', 'time': 'time_slot', 'mode': 'mode',
        'location': 'location', 'link': 'link', 'account': 'account',
        'attendance': 'attendance', 'score': 'score', 'scoreRate': 'score_rate',
        'rank': 'rank', 'result': 'result', 'note': 'note',
    }

    for candidate in Candidate.objects.all():
        history = [row for row in (candidate.exam_history or []) if isinstance(row, dict)]
        session_ids = {str(value) for value in (candidate.session_ids or []) if str(value) in sessions}
        session_ids.update(str(row.get('sessionId')) for row in history if str(row.get('sessionId')) in sessions)
        if not session_ids:
            for code in (candidate.contests or '').replace(';', ',').split(','):
                for session_id in sessions_by_code.get(code.strip().upper(), []):
                    session_ids.add(session_id)

        participations = {}
        for session_id in session_ids:
            participation, _ = CandidateParticipation.objects.get_or_create(
                candidate_id=candidate.id,
                session_id=session_id,
                defaults={'source': ''},
            )
            participations[session_id] = participation

        for row in history:
            session_id = str(row.get('sessionId') or '')
            if not session_id:
                session_id = next(iter(session_ids), '') if len(session_ids) == 1 else ''
            participation = participations.get(session_id)
            round_name = str(row.get('round') or '').strip()
            if not participation or not round_name:
                continue
            values = {field: str(row.get(key) or '').strip() for key, field in mapping.items()}
            values['raw_data'] = {str(key): value for key, value in row.items() if value not in (None, '')}
            RoundResult.objects.update_or_create(
                participation_id=participation.id,
                round_name=round_name,
                defaults=values,
            )


class Migration(migrations.Migration):

    dependencies = [
        ('examination', '0006_candidateparticipation_roundresult_and_more'),
    ]

    operations = [
        migrations.RunPython(migrate_legacy_candidate_history, migrations.RunPython.noop),
    ]
