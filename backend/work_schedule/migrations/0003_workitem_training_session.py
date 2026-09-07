from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("digital_training", "0041_trainingassessmentattempt_grading_notes"),
        ("work_schedule", "0002_workitem_daily_order_and_revision_of"),
    ]

    operations = [
        migrations.AddField(
            model_name="workitem",
            name="training_session",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="work_schedule_item",
                to="digital_training.trainingsession",
            ),
        ),
    ]
