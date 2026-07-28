import re
from django.db import migrations


def split_multi_day_rounds(apps, schema_editor):
    ExamSession = apps.get_model('examination', 'ExamSession')
    pattern = re.compile(r'(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)')
    for session in ExamSession.objects.all():
        rounds = list(session.rounds or [])
        changed = False
        for round_config in rounds:
            if not isinstance(round_config, dict) or round_config.get('slots'):
                continue
            values = pattern.findall(str(round_config.get('label') or ''))
            if len(values) < 2:
                continue
            dates = [f'{year}-{int(month):02d}-{int(day):02d}' for day, month, year in values]
            round_config['date'] = dates[0]
            round_config['slots'] = [
                {'id': f"{round_config.get('id') or 'round'}-day-{index + 1}", 'date': date, 'time': '', 'mode': '', 'link': '', 'location': '', 'note': ''}
                for index, date in enumerate(dates)
            ]
            changed = True
        if changed:
            session.rounds = rounds
            session.save(update_fields=['rounds', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0017_academic_year_sheet_publication')]

    operations = [migrations.RunPython(split_multi_day_rounds, migrations.RunPython.noop)]