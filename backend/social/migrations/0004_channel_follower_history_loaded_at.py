from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("social", "0003_followersnapshot_daily_follows_unique_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="channel",
            name="follower_history_loaded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]