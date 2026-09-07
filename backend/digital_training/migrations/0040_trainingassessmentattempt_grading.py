from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0039_deduplicate_training_session_numbers")]

    operations = [
        migrations.AddField(
            model_name="trainingassessmentattempt",
            name="grading",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
