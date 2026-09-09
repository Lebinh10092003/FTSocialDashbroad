from django.db import migrations, models


def classify_existing_sessions(apps, schema_editor):
    TrainingSession = apps.get_model("digital_training", "TrainingSession")
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    for session in TrainingSession.objects.all().iterator():
        item = WorkItem.objects.filter(training_session_id=session.pk).first()
        if not item:
            continue
        # Projection sessions are created after their source WorkItem. Native
        # Digital Training sessions are created first and only then mirrored to
        # WorkItem, including customer-generated sessions.
        if item.source_sheet_row and item.created_at <= session.created_at:
            TrainingSession.objects.filter(pk=session.pk).update(source="work_schedule")


class Migration(migrations.Migration):
    dependencies = [
        ("digital_training", "0041_trainingassessmentattempt_grading_notes"),
        ("work_schedule", "0014_workitem_time_prefix_in_title"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingsession",
            name="source",
            field=models.CharField(
                choices=[
                    ("internal", "Digital Training"),
                    ("work_schedule", "Work schedule projection"),
                ],
                default="internal",
                max_length=30,
            ),
        ),
        migrations.RunPython(classify_existing_sessions, migrations.RunPython.noop),
    ]
