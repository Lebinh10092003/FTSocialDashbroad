from django.db import migrations


def clear_existing_training_records(apps, schema_editor):
    TrainingMaterial = apps.get_model("digital_training", "TrainingMaterial")
    TrainingSurvey = apps.get_model("digital_training", "TrainingSurvey")
    TrainingSession = apps.get_model("digital_training", "TrainingSession")
    TrainingClass = apps.get_model("digital_training", "TrainingClass")
    TrainingPartner = apps.get_model("digital_training", "TrainingPartner")
    TrainingMaterial.objects.all().delete()
    TrainingSurvey.objects.all().delete()
    TrainingSession.objects.all().delete()
    TrainingClass.objects.all().delete()
    TrainingPartner.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0008_trainingpartner_ai_account_count_and_more")]
    operations = [migrations.RunPython(clear_existing_training_records, migrations.RunPython.noop)]