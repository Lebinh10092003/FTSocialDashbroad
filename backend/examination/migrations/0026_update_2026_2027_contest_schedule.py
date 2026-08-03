from django.db import migrations


# Schedule confirmed from the revised 2026-2027 contest plan.
# Each tuple is: session id, qualifying date, national-final date,
# international-final date.  A blank qualifying date means that the
# competition does not have a national qualifying round.
SCHEDULE = {
    'fiso-2026-2027': ('2027-03-14', '2027-04-11', '2027-07-04'),
    'ipho-2026-2027': ('2026-09-20', '2026-10-25', '2026-12-27'),
    'icho-2026-2027': ('2026-09-20', '2026-10-25', '2026-12-27'),
    'ibo-2026-2027': ('2026-09-20', '2026-10-25', '2026-12-27'),
    'iaio-2026-2027': ('2026-09-13', '2026-10-18', '2026-12-20'),
    'ilso-2026-2027': ('', '2026-10-18', '2026-12-20'),
    'ico-2026-2027': ('2026-12-06', '2027-01-31', '2027-04-11'),
    'igko-2026-2027': ('', '2027-01-31', '2027-04-11'),
    'imao-2026-2027': ('', '2027-01-24', '2027-04-04'),
    'ifko-2026-2027': ('', '2027-01-24', '2027-04-04'),
    'ieo-2026-2027': ('2027-03-21', '2027-05-30', '2027-08-15'),
    'iso-2026-2027': ('2027-03-21', '2027-05-30', '2027-08-15'),
    'imo-2026-2027': ('2027-03-14', '2027-05-23', '2027-08-08'),
    'ieio-2026-2027': ('', '2027-05-23', '2027-08-08'),
}


def label(date_value):
    if not date_value:
        return ''
    year, month, day = date_value.split('-')
    return f'{int(day):02d}/{int(month):02d}/{year}'


def update_round(rounds, round_id, date_value, fallback_name):
    for item in rounds:
        if isinstance(item, dict) and item.get('id') == round_id:
            item['date'] = date_value
            item['label'] = label(date_value)
            return
    if date_value:
        rounds.append({
            'id': round_id,
            'name': fallback_name,
            'date': date_value,
            'label': label(date_value),
            'slots': [],
        })


def forwards(apps, schema_editor):
    ExamSession = apps.get_model('examination', 'ExamSession')
    names = {
        'round-national': 'Vòng loại Quốc gia',
        'round-final': 'Vòng Chung kết Quốc gia',
        'round-international': 'Vòng Chung kết Quốc tế',
    }

    for session_id, (qualifying, final, international) in SCHEDULE.items():
        session = ExamSession.objects.filter(id=session_id).first()
        if not session:
            continue

        rounds = [dict(item) for item in (session.rounds or []) if isinstance(item, dict)]
        if qualifying:
            update_round(rounds, 'round-national', qualifying, names['round-national'])
        else:
            rounds = [item for item in rounds if item.get('id') != 'round-national']
        update_round(rounds, 'round-final', final, names['round-final'])
        update_round(rounds, 'round-international', international, names['round-international'])

        session.rounds = rounds
        session.national = label(final)
        session.national_date = final
        session.international = label(international)
        session.international_date = international
        session.save(update_fields=[
            'rounds',
            'national',
            'national_date',
            'international',
            'international_date',
            'updated_at',
        ])


class Migration(migrations.Migration):
    dependencies = [('examination', '0025_exam_rooms')]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
