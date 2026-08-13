from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0033_trainingassessment_default_max_people_per_variant")]

    operations = [
        migrations.CreateModel(
            name="TrainingQuestionBankSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_key", models.CharField(max_length=255, unique=True)),
                ("source_url", models.URLField()),
                ("source_name", models.CharField(blank=True, max_length=500)),
                ("questions", models.JSONField(blank=True, default=list)),
                ("inventory", models.JSONField(blank=True, default=dict)),
                ("question_count", models.PositiveIntegerField(default=0)),
                ("synced_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["-synced_at"]},
        ),
    ]
