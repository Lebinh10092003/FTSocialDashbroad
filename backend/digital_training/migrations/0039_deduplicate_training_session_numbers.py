from django.db import migrations, models
from django.db.models import Q


def deduplicate_session_numbers(apps, schema_editor):
    TrainingSession = apps.get_model("digital_training", "TrainingSession")
    TrainingMaterial = apps.get_model("digital_training", "TrainingMaterial")
    TrainingSurvey = apps.get_model("digital_training", "TrainingSurvey")
    TrainingAssessment = apps.get_model("digital_training", "TrainingAssessment")

    groups = {}
    for session in TrainingSession.objects.exclude(session_number__isnull=True).order_by("id"):
        if session.training_class_id:
            key = ("class", session.training_class_id, session.session_number)
        elif session.partner_ref_id:
            key = ("partner", session.partner_ref_id, session.session_number)
        else:
            continue
        groups.setdefault(key, []).append(session)

    status_priority = {"completed": 3, "planned": 2, "unscheduled": 1, "cancelled": 0}
    for duplicate_sessions in groups.values():
        if len(duplicate_sessions) < 2:
            continue
        # A dated session is more authoritative than an empty placeholder.
        kept = max(
            duplicate_sessions,
            key=lambda item: (
                bool(item.session_date),
                bool(item.start_time),
                status_priority.get(item.status, 0),
                item.updated_at,
                item.id,
            ),
        )
        discarded = [item for item in duplicate_sessions if item.pk != kept.pk]

        for item in discarded:
            TrainingMaterial.objects.filter(session_id=item.pk).update(session_id=kept.pk)
            TrainingSurvey.objects.filter(session_id=item.pk).update(session_id=kept.pk)
            TrainingAssessment.objects.filter(session_id=item.pk).update(session_id=kept.pk)
            item.delete()


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0038_trainingassessmentattempt_drive_folder_id")]

    operations = [
        migrations.RunPython(deduplicate_session_numbers, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="trainingsession",
            constraint=models.UniqueConstraint(
                fields=("partner_ref", "session_number"),
                condition=Q(("partner_ref__isnull", False), ("training_class__isnull", True)),
                name="unique_partner_session_number",
            ),
        ),
        migrations.AddConstraint(
            model_name="trainingsession",
            constraint=models.UniqueConstraint(
                fields=("training_class", "session_number"),
                condition=Q(("training_class__isnull", False)),
                name="unique_class_session_number",
            ),
        ),
    ]
