from django.db import migrations, models


def classify_existing_sheets(apps, schema_editor):
    ExaminationSheet = apps.get_model('examination', 'ExaminationSheet')
    for sheet in ExaminationSheet.objects.exclude(stage__in=['registration-source', 'session-output']):
        # Output sources created by the session workflow already used the
        # canonical `session-output` stage. Legacy free-form stages came from
        # the generic import UI and must remain input sources.
        sheet.stage = 'registration-source'
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
