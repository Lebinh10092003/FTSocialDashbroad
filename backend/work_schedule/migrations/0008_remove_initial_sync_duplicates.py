import re
import unicodedata
from difflib import SequenceMatcher

from django.db import migrations


def normalized(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def remove_duplicates(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    groups = WorkItem.objects.filter(source_sheet_row__range=(1094, 1243)).values_list(
        "executor_id", "work_date"
    ).distinct()
    for executor_id, work_date in groups:
        sources = list(WorkItem.objects.filter(
            executor_id=executor_id,
            work_date=work_date,
            source_sheet_row__range=(1094, 1243),
        ))
        extras = list(WorkItem.objects.filter(
            executor_id=executor_id,
            work_date=work_date,
            source_sheet_row__isnull=True,
        ))
        source_titles = [normalized(item.title) for item in sources]
        for extra in extras:
            title = normalized(extra.title)
            similarity = max((SequenceMatcher(None, title, source).ratio() for source in source_titles), default=0)
            if similarity >= 0.9:
                extra.delete()
        rows = WorkItem.objects.filter(executor_id=executor_id, work_date=work_date).order_by(
            "daily_order", "start_time", "created_at", "pk"
        )
        for order, item in enumerate(rows, 1):
            if item.daily_order != order:
                WorkItem.objects.filter(pk=item.pk).update(daily_order=order)


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0007_sheet_two_way_sync")]
    operations = [migrations.RunPython(remove_duplicates, migrations.RunPython.noop)]
