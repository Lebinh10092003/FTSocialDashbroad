import uuid
from datetime import date

from django.db import migrations


def reconcile(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    Change = apps.get_model("work_schedule", "WorkScheduleSheetChange")
    WorkItem.objects.filter(sync_uid="d54cb51b-3eca-4e34-8b71-1fb7c64de93f").delete()
    WorkItem.objects.filter(
        sync_uid=uuid.UUID("6ae71379-0000-5000-8000-00044a000001")
    ).update(
        work_date=date(2026, 9, 7),
        daily_order=1,
        source_sheet_row=1098,
        source_task_index=1,
        source_sync_hash="",
    )
    Change.objects.filter(
        executor_email="phongnt@fermat.edu.vn",
        work_date__in=[date(2026, 9, 7), date(2026, 9, 8)],
        status__in=["pending", "processing", "failed", "conflict"],
    ).update(status="done", last_error="")


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0009_repair_phong_week37_sync_identity")]
    operations = [migrations.RunPython(reconcile, migrations.RunPython.noop)]
