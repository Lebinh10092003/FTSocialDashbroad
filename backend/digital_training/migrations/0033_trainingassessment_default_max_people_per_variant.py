from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0032_set_default_question_bank_url")]

    operations = [
        migrations.AlterField(
            model_name="trainingassessment",
            name="max_people_per_variant",
            field=models.PositiveIntegerField(default=12),
        ),
    ]
