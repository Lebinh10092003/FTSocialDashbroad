from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("social", "0004_channel_follower_history_loaded_at")]

    operations = [
        migrations.AddField(
            model_name="channel",
            name="initial_sync_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
