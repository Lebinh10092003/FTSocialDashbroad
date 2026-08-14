from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("digital_training", "0037_trainingassessment_legacy_public_slugs"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingassessmentattempt",
            name="drive_folder_id",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
