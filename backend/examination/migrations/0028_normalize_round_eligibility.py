from django.db import migrations, models


ELIGIBLE = 'Đủ điều kiện'
INELIGIBLE = 'Không đủ điều kiện'


def normalize_existing_eligibility(apps, schema_editor):
    RoundResult = apps.get_model('examination', 'RoundResult')
    for item in RoundResult.objects.all().only('id', 'eligibility').iterator():
        raw = str(item.eligibility or '').casefold()
        normalized = INELIGIBLE if ('không đủ điều kiện' in raw or 'khong du dieu kien' in raw or 'chưa đủ điều kiện' in raw or 'chua du dieu kien' in raw) else ELIGIBLE
        if item.eligibility != normalized:
            RoundResult.objects.filter(pk=item.pk).update(eligibility=normalized)


class Migration(migrations.Migration):
    dependencies = [('examination', '0027_examinationsheet_automation')]

    operations = [
        migrations.AlterField(
            model_name='roundresult',
            name='eligibility',
            field=models.CharField(blank=True, default=ELIGIBLE, max_length=1000),
        ),
        migrations.RunPython(normalize_existing_eligibility, migrations.RunPython.noop),
    ]