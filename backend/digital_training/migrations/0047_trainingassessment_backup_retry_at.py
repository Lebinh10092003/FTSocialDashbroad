from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0046_product_subscription_expiry_notifications")]

    operations = [
        migrations.AddField(
            model_name="trainingassessment",
            name="backup_retry_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
