from django.db import migrations, models


def make_training_subscriptions_unlimited(apps, schema_editor):
    Subscription = apps.get_model("digital_training", "TrainingProductSubscription")
    for subscription in Subscription.objects.select_related("partner").filter(product__code="tap-huan"):
        subscription.expires_at = None
        subscription.expiry_notice_stage = 0
        if subscription.partner.planned_sessions:
            subscription.quantity = subscription.partner.planned_sessions
        subscription.save(update_fields=["expires_at", "expiry_notice_stage", "quantity"])


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0045_assessment_retention_counter")]

    operations = [
        migrations.AddField(
            model_name="trainingproductsubscription",
            name="expiry_notice_stage",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.RunPython(make_training_subscriptions_unlimited, migrations.RunPython.noop),
    ]
