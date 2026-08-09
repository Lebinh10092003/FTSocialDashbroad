from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("social", "0006_channel_last_data_sync_until")]

    operations = [
        migrations.AddField(
            model_name="channel",
            name="metric_history_loaded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ChannelMetricSnapshot",
            fields=[
                ("snapshot_key", models.CharField(max_length=255, primary_key=True, serialize=False)),
                ("snapshot_date", models.CharField(max_length=50)),
                ("channel_id", models.CharField(max_length=255)),
                ("views", models.IntegerField(default=0)),
                ("engagement", models.IntegerField(default=0)),
                ("fetched_at", models.DateTimeField()),
            ],
            options={
                "indexes": [models.Index(fields=["channel_id", "snapshot_date"], name="social_channel_metric_date")],
            },
        ),
    ]