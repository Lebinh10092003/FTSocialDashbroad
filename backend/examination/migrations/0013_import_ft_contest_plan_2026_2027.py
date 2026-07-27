from django.db import migrations


PLAN = (
    ('fimo', 'FIMO', 'Fermat - International Mathematic Olympiad', 'FT', '20/09/2026; 06/12/2026; 28/02/2027', '2026-09-20', '25/04/2027', '2027-04-25', '11/07/2027', '2027-07-11'),
    ('fieo', 'FIEO', 'Fermat - International English Olympiad', 'FT', '27/09/2026; 13/12/2026; 07/03/2027', '2026-09-27', '02/05/2027', '2027-05-02', '18/07/2027', '2027-07-18'),
    ('fiaio', 'FIAIO', 'Fermat - International AI Olympiad', 'FT', '14/03/2027', '2027-03-14', '11/04/2027', '2027-04-11', '04/07/2027', '2027-07-04'),
    ('fiso', 'FISO', 'Fermat - International Science Olympiad', 'FT', '14/03/2027', '2027-03-14', '11/04/2027', '2027-04-11', '04/07/2027', '2027-07-04'),
    ('ipho', 'IPhO', 'International Physics Olympiad', 'SCO', '13/09/2026', '2026-09-13', '25/10/2026', '2026-10-25', '13/12/2026', '2026-12-13'),
    ('icho', 'IChO', 'International Chemistry Olympiad', 'SCO', '13/09/2026', '2026-09-13', '25/10/2026', '2026-10-25', '13/12/2026', '2026-12-13'),
    ('ibo', 'IBO', 'International Biology Olympiad', 'SCO', '13/09/2026', '2026-09-13', '18/10/2026', '2026-10-18', '06/12/2026', '2026-12-06'),
    ('ilso', 'ILSO', 'International Life Skill Olympiad SDGs', 'SCO', '', '', '18/10/2026', '2026-10-18', '06/12/2026', '2026-12-06'),
    ('iaio', 'IAIO', 'International Artificial Intelligence Olympiad', 'SCO', '06/12/2026', '2026-12-06', '31/01/2027', '2027-01-31', '11/04/2027', '2027-04-11'),
    ('iso', 'ISO', 'International Science Olympiad', 'SCO', '06/12/2026', '2026-12-06', '31/01/2027', '2027-01-31', '11/04/2027', '2027-04-11'),
    ('igko', 'IGKO', 'International General Knowledge Olympiad', 'SCO', '', '', '24/01/2027', '2027-01-24', '04/04/2027', '2027-04-04'),
    ('imao', 'IMAO', 'International Mental Ability Olympiad', 'SCO', '', '', '24/01/2027', '2027-01-24', '04/04/2027', '2027-04-04'),
    ('ifko', 'IFKO', 'International Finance Knowledge Olympiad', 'SCO', '', '', '24/01/2027', '2027-01-24', '04/04/2027', '2027-04-04'),
    ('imo', 'IMO', 'International Math Olympiad', 'SCO', '21/03/2027', '2027-03-21', '30/05/2027', '2027-05-30', '15/08/2027', '2027-08-15'),
    ('ieo', 'IEO', 'International English Olympiad', 'SCO', '21/03/2027', '2027-03-21', '30/05/2027', '2027-05-30', '15/08/2027', '2027-08-15'),
    ('ico', 'ICO', 'International Coding Olympiad', 'SCO', '21/03/2027', '2027-03-21', '22/05/2027', '2027-05-22', '08/08/2027', '2027-08-08'),
    ('ieio', 'IEIO', 'International Entrepreneurship & Innovation Olympiad', 'SCO', '', '', '22/05/2027', '2027-05-22', '08/08/2027', '2027-08-08'),
    ('aysbc', 'AYSBC', 'Asia Young Scientist Badge Competition', 'SCSG & MK', '', '', '', '', '', ''),
)

LEGACY_CODES = {'SIMO': 'IMO', 'SIEO': 'IEO', 'SISO': 'ISO'}
ROUND_NAMES = ('V\u00f2ng lo\u1ea1i Qu\u1ed1c gia', 'V\u00f2ng Chung k\u1ebft Qu\u1ed1c gia', 'V\u00f2ng Chung k\u1ebft Qu\u1ed1c t\u1ebf')


def make_rounds(qualifying_label, qualifying_date, final_label, final_date, international_label, international_date):
    values = []
    for key, name, label, date in zip(
        ('round-national', 'round-final', 'round-international'),
        ROUND_NAMES,
        (qualifying_label, final_label, international_label),
        (qualifying_date, final_date, international_date),
    ):
        if label:
            values.append({'id': key, 'name': name, 'label': label, 'date': date, 'slots': []})
    return values


def forwards(apps, schema_editor):
    Competition = apps.get_model('examination', 'Competition')
    ExamSession = apps.get_model('examination', 'ExamSession')
    Candidate = apps.get_model('examination', 'Candidate')

    for old_code, new_code in LEGACY_CODES.items():
        Competition.objects.filter(code__iexact=old_code).update(code=new_code)
        ExamSession.objects.filter(code__iexact=old_code).update(code=new_code)

    for candidate in Candidate.objects.all().iterator():
        codes = [LEGACY_CODES.get(code.strip().upper(), code.strip().upper()) for code in (candidate.contests or '').split(',') if code.strip()]
        candidate.contests = ', '.join(dict.fromkeys(codes))
        history = candidate.exam_history if isinstance(candidate.exam_history, list) else []
        history_changed = False
        for item in history:
            if isinstance(item, dict) and str(item.get('sessionCode') or '').upper() in LEGACY_CODES:
                item['sessionCode'] = LEGACY_CODES[str(item['sessionCode']).upper()]
                history_changed = True
        fields = ['contests']
        if history_changed:
            candidate.exam_history = history
            fields.append('exam_history')
        candidate.save(update_fields=fields)

    for item_id, code, name, organizer, qualifying_label, qualifying_date, final_label, final_date, international_label, international_date in PLAN:
        Competition.objects.update_or_create(
            id=item_id,
            defaults={'code': code, 'name': name, 'parent': name, 'organizer': organizer, 'sort_key': f'{code.lower()}_{item_id}'},
        )
        if not any((qualifying_label, final_label, international_label)):
            continue
        ExamSession.objects.update_or_create(
            id=f'{item_id}-2026-2027',
            defaults={
                'competition_id': item_id, 'code': code, 'name': 'N\u0103m h\u1ecdc 2026-2027', 'parent': name,
                'organizer': organizer, 'time': '2026-2027', 'candidates_count': 0,
                'national': final_label, 'national_date': final_date,
                'international': international_label, 'international_date': international_date,
                'phase': 'Chu\u1ea9n b\u1ecb/Truy\u1ec1n th\u00f4ng',
                'note': 'Schedule imported from the FT 2026-2027 contest plan.',
                'rounds': make_rounds(qualifying_label, qualifying_date, final_label, final_date, international_label, international_date),
                'sort_key': f'{code.lower()}_{item_id}-2026-2027',
            },
        )


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [('examination', '0012_lognote_actor_identity')]
    operations = [migrations.RunPython(forwards, backwards)]