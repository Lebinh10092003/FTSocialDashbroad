from django.db import migrations, models, transaction


AYSBC_SESSION_ID = 'aysbc'
AYSBC_LEGACY_SESSION_ID = 'session-351ba22f9c'
FINAL_ROUND_ID = 'aysbc-national-final'
REGIONAL_ROUND_ID = 'aysbc-regional'
JUNE_OCCURRENCE_ID = 'aysbc-national-final-2026-06'
JULY_OCCURRENCE_ID = 'aysbc-national-final-2026-07'
REGIONAL_OCCURRENCE_ID = 'aysbc-regional-2026-10'


def clean(value):
    return str(value or '').strip()


def merge_nonempty(target, source, fields):
    changed = []
    for field in fields:
        if not clean(getattr(target, field, '')) and clean(getattr(source, field, '')):
            setattr(target, field, getattr(source, field))
            changed.append(field)
    if changed:
        target.save(update_fields=changed)


def occurrence_for_result(result):
    value = clean(result.exam_date)
    if value in {'2026-06-21', '21/06/2026'}:
        return JUNE_OCCURRENCE_ID
    if value in {'2026-07-26', '26/07/2026'}:
        return JULY_OCCURRENCE_ID
    return clean(result.occurrence_id)


def consolidate_aysbc(apps, schema_editor):
    ExamSession = apps.get_model('examination', 'ExamSession')
    Candidate = apps.get_model('examination', 'Candidate')
    CandidateParticipation = apps.get_model('examination', 'CandidateParticipation')
    RoundResult = apps.get_model('examination', 'RoundResult')
    ExamRoom = apps.get_model('examination', 'ExamRoom')
    ExaminationSheet = apps.get_model('examination', 'ExaminationSheet')
    Blueprint = apps.get_model('examination', 'Blueprint')
    ExamPaper = apps.get_model('examination', 'ExamPaper')
    LogNote = apps.get_model('examination', 'LogNote')

    canonical = ExamSession.objects.filter(pk=AYSBC_SESSION_ID).first()
    legacy = ExamSession.objects.filter(pk=AYSBC_LEGACY_SESSION_ID).first()
    if not canonical:
        return

    final_slots = [
        {
            'id': JUNE_OCCURRENCE_ID,
            'label': 'Đợt 1 · Tháng 6/2026',
            'date': '2026-06-21',
            'time': '9:00 - 10:00',
            'mode': 'Trực tuyến',
            'link': 'https://youngscientist.sscglobal.com.sg/',
            'location': '',
            'note': 'Đợt tổ chức Vòng Chung kết Quốc gia tháng 6/2026.',
        },
        {
            'id': JULY_OCCURRENCE_ID,
            'label': 'Đợt 2 · Tháng 7/2026',
            'date': '2026-07-26',
            'time': '9:00 - 10:00',
            'mode': 'Trực tuyến',
            'link': 'https://youngscientist.sscglobal.com.sg/',
            'location': '',
            'note': 'Đợt tổ chức Vòng Chung kết Quốc gia tháng 7/2026.',
        },
    ]
    canonical.rounds = [
        {
            'id': FINAL_ROUND_ID,
            'name': 'Vòng Chung kết Quốc gia',
            'label': 'Đợt T6/2026 và T7/2026',
            'date': '2026-06-21',
            'slots': final_slots,
        },
        {
            'id': REGIONAL_ROUND_ID,
            'name': 'Vòng Khu vực',
            'label': 'Đợt chung · T10/2026',
            'date': '',
            'slots': [{
                'id': REGIONAL_OCCURRENCE_ID,
                'label': 'Đợt chung · T10/2026',
                'date': '',
                'time': '',
                'mode': '',
                'link': '',
                'location': '',
                'note': 'Một đợt chung cho thí sinh của cả hai đợt Chung kết Quốc gia.',
            }],
        },
    ]
    canonical.time = 'T6/2026 – T10/2026'
    canonical.national = 'Đợt T6/2026 và T7/2026'
    canonical.national_date = '2026-06-21'
    canonical.international = 'Đợt chung T10/2026'
    canonical.international_date = ''
    canonical.note = 'Gộp hai đợt AYSBC 2026. Danh sách thí sinh được tách theo đợt tổ chức ở từng vòng.'
    canonical.save(update_fields=['rounds', 'time', 'national', 'national_date', 'international', 'international_date', 'note', 'updated_at'])

    with transaction.atomic():
        # Normalise the canonical records first.  Every existing result keeps
        # its original date and is simply assigned to the matching batch.
        for result in RoundResult.objects.filter(participation__session_id=canonical.id).iterator():
            result.round_id = FINAL_ROUND_ID
            result.round_name = 'Vòng Chung kết Quốc gia'
            result.occurrence_id = occurrence_for_result(result)
            result.save(update_fields=['round_id', 'round_name', 'occurrence_id'])

        if legacy:
            Blueprint.objects.filter(session_id=legacy.id).update(session_id=canonical.id)
            ExamPaper.objects.filter(session_id=legacy.id).update(session_id=canonical.id)
            ExaminationSheet.objects.filter(session_id=legacy.id).update(session_id=canonical.id)

            for room in ExamRoom.objects.filter(session_id=legacy.id).iterator():
                room.session_id = canonical.id
                room.round_id = FINAL_ROUND_ID
                room.round_name = 'Vòng Chung kết Quốc gia'
                room.occurrence_id = JUNE_OCCURRENCE_ID
                room.save(update_fields=['session', 'round_id', 'round_name', 'occurrence_id'])

            for source in CandidateParticipation.objects.filter(session_id=legacy.id).iterator():
                target, created = CandidateParticipation.objects.get_or_create(
                    candidate_id=source.candidate_id,
                    session_id=canonical.id,
                    defaults={
                        'source': source.source,
                        'subject': source.subject,
                        'category': source.category,
                        'registration_method': source.registration_method,
                        'registration_unit': source.registration_unit,
                        'team_name': source.team_name,
                        'exam_language': source.exam_language,
                        'general_note': source.general_note,
                        'certificate_link': source.certificate_link,
                        'registration_data': source.registration_data,
                    },
                )
                if not created:
                    merge_nonempty(target, source, [
                        'source', 'subject', 'category', 'registration_method',
                        'registration_unit', 'team_name', 'exam_language', 'general_note',
                        'certificate_link',
                    ])

                for result in RoundResult.objects.filter(participation_id=source.id).iterator():
                    result.round_id = FINAL_ROUND_ID
                    result.round_name = 'Vòng Chung kết Quốc gia'
                    result.occurrence_id = occurrence_for_result(result) or JUNE_OCCURRENCE_ID
                    collision = RoundResult.objects.filter(
                        participation_id=target.id,
                        round_id=result.round_id,
                        occurrence_id=result.occurrence_id,
                    ).exclude(pk=result.pk).first()
                    if collision:
                        merge_nonempty(collision, result, [
                            'eligibility', 'sbd', 'exam_date', 'time_slot', 'mode', 'location',
                            'link', 'account', 'password', 'attendance', 'score', 'score_rate',
                            'rank', 'result', 'note',
                        ])
                        result.delete()
                    else:
                        result.participation_id = target.id
                        result.save(update_fields=['participation', 'round_id', 'round_name', 'occurrence_id'])
                source.delete()

            for candidate in Candidate.objects.all().iterator():
                session_ids = list(candidate.session_ids or [])
                history = list(candidate.exam_history or [])
                changed = False
                if legacy.id in session_ids:
                    candidate.session_ids = list(dict.fromkeys([canonical.id if value == legacy.id else value for value in session_ids]))
                    changed = True
                for item in history:
                    if not isinstance(item, dict):
                        continue
                    if item.get('sessionId') in {canonical.id, legacy.id}:
                        item['sessionId'] = canonical.id
                        item['roundId'] = FINAL_ROUND_ID
                        date = clean(item.get('date'))
                        item['occurrenceId'] = JUNE_OCCURRENCE_ID if date in {'2026-06-21', '21/06/2026'} else JULY_OCCURRENCE_ID if date in {'2026-07-26', '26/07/2026'} else item.get('occurrenceId', '')
                        changed = True
                if changed:
                    candidate.exam_history = history
                    candidate.save(update_fields=['session_ids', 'exam_history'])

            LogNote.objects.filter(entity_key=f'session-{legacy.id}').update(entity_key=f'session-{canonical.id}')
            legacy.delete()

        canonical.candidates_count = CandidateParticipation.objects.filter(session_id=canonical.id).count()
        canonical.save(update_fields=['candidates_count', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0030_exam_room_exam_links')]

    operations = [
        migrations.AddField(
            model_name='examroom',
            name='occurrence_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='roundresult',
            name='occurrence_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=255),
        ),
        migrations.RemoveConstraint(model_name='examroom', name='unique_exam_room_number_per_round'),
        migrations.RemoveConstraint(model_name='roundresult', name='unique_round_per_participation'),
        migrations.RunPython(consolidate_aysbc, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='examroom',
            constraint=models.UniqueConstraint(fields=('session', 'round_id', 'occurrence_id', 'room_number'), name='unique_exam_room_number_per_occurrence'),
        ),
        migrations.AddConstraint(
            model_name='roundresult',
            constraint=models.UniqueConstraint(fields=('participation', 'round_id', 'round_name', 'occurrence_id'), name='unique_round_occurrence_per_participation'),
        ),
    ]
