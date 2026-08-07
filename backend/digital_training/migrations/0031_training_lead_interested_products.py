from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0030_training_session_staff_roles")]

    operations = [
        migrations.AddField(
            model_name="traininglead",
            name="interested_products",
            field=models.JSONField(blank=True, default=list),
        ),
    ]