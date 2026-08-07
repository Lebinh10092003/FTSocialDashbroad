import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0028_add_customer_leads"), ("digital_training", "0026_add_training_dashboard_chromebook_products")]

    operations = [
        migrations.CreateModel(
            name="TrainingProductOpportunity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("negotiating", "Negotiating"), ("on_hold", "On hold"), ("won", "Won"), ("lost", "Lost")], default="negotiating", max_length=20)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("partner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="product_opportunities", to="digital_training.trainingpartner")),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="opportunities", to="digital_training.trainingproduct")),
            ],
            options={"ordering": ["partner__name", "-updated_at", "-id"]},
        ),
        migrations.AddField(model_name="trainingcustomermeeting", name="partner", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="customer_meetings", to="digital_training.trainingpartner")),
        migrations.AddField(model_name="trainingcustomermeeting", name="opportunity", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="meetings", to="digital_training.trainingproductopportunity")),
    ]