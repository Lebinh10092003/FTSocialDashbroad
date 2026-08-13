from django.db import migrations


QUESTION_BANK_CONFIG_KEY = "digital_training_question_bank"
DEFAULT_QUESTION_BANK_URL = "https://docs.google.com/spreadsheets/d/1zdlpFOO7p93DuQbXpRhvG4xi89u6L7O-2O1UqBaAV3c/edit?usp=sharing"


def set_default_question_bank_url(apps, schema_editor):
    SystemConfig = apps.get_model("authentication", "SystemConfig")
    config, _ = SystemConfig.objects.get_or_create(key=QUESTION_BANK_CONFIG_KEY)
    data = config.data if isinstance(config.data, dict) else {}
    config.data = {**data, "default_url": DEFAULT_QUESTION_BANK_URL}
    config.save(update_fields=["data"])


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0004_refresh_admin_and_facebook_ttl"),
        ("digital_training", "0031_training_lead_interested_products"),
    ]

    operations = [migrations.RunPython(set_default_question_bank_url, migrations.RunPython.noop)]
