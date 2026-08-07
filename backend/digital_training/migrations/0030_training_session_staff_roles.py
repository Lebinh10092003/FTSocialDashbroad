from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0029_customer_product_opportunities")]

    operations = [
        migrations.AddField(
            model_name="trainingsession",
            name="instructor_name",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="trainingsession",
            name="support_staff_name",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]