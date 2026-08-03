from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("social", "0005_channel_initial_sync_completed_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="channel",
            name="last_data_sync_until",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
