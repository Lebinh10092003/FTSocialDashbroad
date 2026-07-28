import re

from django.db import migrations


def populate_session_numbers(apps, schema_editor):
    Session = apps.get_model("digital_training", "TrainingSession")
    for session in Session.objects.filter(session_number__isnull=True):
        match = re.match(r"^Buổi\s+(\d+)", session.title or "")
        if match:
            session.session_number = int(match.group(1))
            session.save(update_fields=["session_number"])


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0006_trainingsession_session_number")]
    operations = [migrations.RunPython(populate_session_numbers, migrations.RunPython.noop)]