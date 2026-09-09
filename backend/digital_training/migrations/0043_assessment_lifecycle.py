from django.db import migrations, models
from django.utils import timezone


def seed_lifecycle_dates(apps, schema_editor):
    Assessment = apps.get_model('digital_training', 'TrainingAssessment')
    Attempt = apps.get_model('digital_training', 'TrainingAssessmentAttempt')
    Attempt.objects.update(purge_after=None)
    for item in Assessment.objects.filter(status='closed', closed_at__isnull=True).iterator():
        item.closed_at = item.closes_at or item.updated_at or timezone.now()
        item.save(update_fields=['closed_at'])


class Migration(migrations.Migration):
    dependencies = [('digital_training', '0042_training_session_source')]

    operations = [
        migrations.AlterField(
            model_name='trainingassessment', name='status',
            field=models.CharField(choices=[('draft', 'Bản nháp'), ('published', 'Đang mở'), ('closed', 'Đã đóng'), ('graded', 'Đã chấm'), ('backup_complete', 'Đã hoàn thành sao lưu')], default='draft', max_length=20),
        ),
        migrations.AddField(model_name='trainingassessment', name='closed_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='trainingassessment', name='graded_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='trainingassessment', name='backup_completed_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='trainingassessment', name='backup_manifest', field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name='trainingassessment', name='trashed_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='trainingassessment', name='purge_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.RunPython(seed_lifecycle_dates, migrations.RunPython.noop),
    ]
