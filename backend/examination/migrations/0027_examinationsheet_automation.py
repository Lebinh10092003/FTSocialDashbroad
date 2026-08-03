from django.db import migrations, models


def classify_existing_sheets(apps, schema_editor):
    ExaminationSheet = apps.get_model('examination', 'ExaminationSheet')
    ExamSession = apps.get_model('examination', 'ExamSession')
    for sheet in ExaminationSheet.objects.exclude(stage__in=['registration-source', 'session-output']):
        session = ExamSession.objects.filter(id=sheet.session_id).first()
        is_output = bool(
            session
            and session.output_sheet_url
            and str(session.output_sheet_url).strip() == str(sheet.url).strip()
        )
        sheet.stage = 'session-output' if is_output else 'registration-source'
        sheet.save(update_fields=['stage'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0026_update_2026_2027_contest_schedule')]

    operations = [
        migrations.AddField(model_name='examinationsheet', name='automation_enabled', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='examinationsheet', name='automation_start_date', field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name='examinationsheet', name='automation_end_date', field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name='examinationsheet', name='last_import_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='examinationsheet', name='last_export_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='examinationsheet', name='last_content_fingerprint', field=models.CharField(blank=True, default='', max_length=64)),
        migrations.AddField(model_name='examinationsheet', name='pending_manual_import', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='examinationsheet', name='last_error', field=models.TextField(blank=True, default='')),
        migrations.RunPython(classify_existing_sheets, migrations.RunPython.noop),
    ]
