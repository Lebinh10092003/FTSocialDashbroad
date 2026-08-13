from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0034_trainingquestionbanksnapshot")]

    operations = [migrations.RemoveField(model_name="trainingquestionbanksnapshot", name="questions")]
