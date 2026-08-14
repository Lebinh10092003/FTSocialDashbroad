from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0035_remove_trainingquestionbanksnapshot_questions")]

    operations = [
        migrations.AddField(
            model_name="trainingassessmentattempt",
            name="position",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
