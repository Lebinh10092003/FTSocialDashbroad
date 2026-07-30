from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("digital_training", "0020_trainingassessment_trainingassessmentattempt_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingassessment",
            name="generation_config",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="trainingassessment",
            name="generation_mode",
            field=models.CharField(
                choices=[
                    ("prepared", "Prepared variants"),
                    ("auto_generate", "Auto-generate from import"),
                ],
                default="prepared",
                max_length=30,
            ),
        ),
    ]
