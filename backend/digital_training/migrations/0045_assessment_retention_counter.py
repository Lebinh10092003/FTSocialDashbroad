from datetime import timedelta

from django.db import migrations, models
from django.utils import timezone


MILESTONES = (14, 21, 28, 31)


def seed_retention_counters_and_statuses(apps, schema_editor):
    Assessment = apps.get_model("digital_training", "TrainingAssessment")
    now = timezone.now()
    terminal = Assessment.objects.filter(
        status__in=["closed", "graded", "backup_complete"],
        trashed_at__isnull=True,
    )
    for assessment in terminal.iterator():
        started = assessment.closed_at or assessment.closes_at or assessment.updated_at or now
        assessment.retention_started_at = started
        elapsed = max(0, (now.date() - started.date()).days)
        assessment.retention_milestone = max((day for day in MILESTONES if day <= elapsed), default=0)
        next_day = next((day for day in MILESTONES if day > elapsed), None)
        assessment.next_lifecycle_at = started + timedelta(days=next_day) if next_day else now
        completed = assessment.attempts.filter(status__in=["submitted", "timed_out"])
        if (
            assessment.status == "closed"
            and completed.exists()
            and not completed.filter(manual_grading_required=True).exists()
            and not completed.filter(score__isnull=True).exists()
        ):
            assessment.status = "graded"
            assessment.graded_at = assessment.graded_at or now
        assessment.save(update_fields=[
            "status", "graded_at", "retention_started_at", "next_lifecycle_at", "retention_milestone",
        ])


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0044_backfill_assessment_retention_anchor")]

    operations = [
        migrations.AlterField(
            model_name="trainingassessment",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Bản nháp"),
                    ("published", "Đang mở"),
                    ("closed", "Đã đóng"),
                    ("graded", "Đã chấm bài"),
                    ("backup_complete", "Đã hoàn thành sao lưu"),
                ],
                default="draft",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="trainingassessment",
            name="retention_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="trainingassessment",
            name="next_lifecycle_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="trainingassessment",
            name="retention_milestone",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.RunPython(seed_retention_counters_and_statuses, migrations.RunPython.noop),
    ]
