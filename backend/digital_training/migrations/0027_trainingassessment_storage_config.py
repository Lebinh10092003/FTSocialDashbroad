from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0026_trainingfinanceentry")]

    operations = [
        migrations.AddField(
            model_name="trainingassessment",
            name="storage_config",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
