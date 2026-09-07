from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0040_trainingassessmentattempt_grading")]

    operations = [
        migrations.AddField(
            model_name="trainingassessmentattempt",
            name="grading_notes",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
