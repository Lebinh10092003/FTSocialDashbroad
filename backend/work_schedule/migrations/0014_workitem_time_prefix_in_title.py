from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0013_deduplicate_training_work_items")]

    operations = [
        migrations.AddField(
            model_name="workitem",
            name="time_prefix_in_title",
            field=models.BooleanField(default=False),
        ),
    ]
