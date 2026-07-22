from django.db import migrations


RENAME = {'IMO': 'SIMO', 'IEO': 'SIEO', 'ISO': 'SISO'}
PARENTS = {'imo': 'SCO - IMO', 'ieo': 'SCO - IEO', 'iso': 'SCO - ISO'}


def forwards(apps, schema_editor):
    Competition = apps.get_model('examination', 'Competition')
    ExamSession = apps.get_model('examination', 'ExamSession')
    Candidate = apps.get_model('examination', 'Candidate')
    for item_id, parent in PARENTS.items():
        code = RENAME[item_id.upper()]
        Competition.objects.filter(id=item_id).update(code=code, parent=parent)
        ExamSession.objects.filter(id=item_id).update(code=code, parent=parent)
    for candidate in Candidate.objects.all():
        values = [RENAME.get(item.strip().upper(), item.strip().upper()) for item in (candidate.contests or '').split(',') if item.strip()]
        candidate.contests = ', '.join(dict.fromkeys(values))
        candidate.save(update_fields=['contests'])


def backwards(apps, schema_editor):
    reverse = {value: key for key, value in RENAME.items()}
    Competition = apps.get_model('examination', 'Competition')
    ExamSession = apps.get_model('examination', 'ExamSession')
    Candidate = apps.get_model('examination', 'Candidate')
    for item_id in PARENTS:
        code = reverse[RENAME[item_id.upper()]]
        Competition.objects.filter(id=item_id).update(code=code)
        ExamSession.objects.filter(id=item_id).update(code=code)
    for candidate in Candidate.objects.all():
        values = [reverse.get(item.strip().upper(), item.strip().upper()) for item in (candidate.contests or '').split(',') if item.strip()]
        candidate.contests = ', '.join(dict.fromkeys(values))
        candidate.save(update_fields=['contests'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0004_examinationsheet_session_id_and_more')]
    operations = [migrations.RunPython(forwards, backwards)]
