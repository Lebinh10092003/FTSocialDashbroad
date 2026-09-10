from datetime import timedelta

from django.db import migrations
from django.db.models import Max


def backfill_retention_anchor(apps, schema_editor):
    Assessment = apps.get_model("digital_training", "TrainingAssessment")
    terminal = Assessment.objects.filter(
        status__in=["closed", "graded", "backup_complete"],
        closed_at__isnull=True,
    )
    for assessment in terminal.iterator():
        attempts = assessment.attempts.filter(status__in=["submitted", "timed_out"]).aggregate(
            last_submitted=Max("submitted_at"),
            last_expiry=Max("expires_at"),
        )
        candidates = [value for value in attempts.values() if value]
        assessment.closed_at = (
            assessment.closes_at
            or (max(candidates) if candidates else None)
            or ((assessment.opens_at or assessment.created_at) + timedelta(minutes=max(1, assessment.duration_minutes or 1)))
        )
        assessment.save(update_fields=["closed_at"])


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0043_assessment_lifecycle")]

    operations = [migrations.RunPython(backfill_retention_anchor, migrations.RunPython.noop)]
