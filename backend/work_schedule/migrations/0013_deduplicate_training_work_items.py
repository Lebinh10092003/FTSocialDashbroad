from django.db import migrations
VERIFIED_DUPLICATES = [
    ("liennt@fermat.edu.vn", "2026-07-25", "Tập huấn tại Phòng VHXH Yên Lãng"),
    ("liennt@fermat.edu.vn", "2026-09-12", "Tập huấn B3, B4 TH Kim Đồng"),
    ("liennt@fermat.edu.vn", "2026-09-13", "Tập huấn B3, B4 MN Đại Mỗ"),
]


def deduplicate_training_work_items(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    for executor_id, work_date, title in VERIFIED_DUPLICATES:
        rows = list(
            WorkItem.objects.filter(
                executor_id=executor_id,
                work_date=work_date,
                title=title,
            ).order_by("id")
        )
        if len(rows) != 2:
            continue
        keeper = next((row for row in rows if row.training_session_id), rows[0])
        timed = next((row for row in rows if row.start_time), None)
        update_fields = []
        if timed and not keeper.start_time:
            keeper.start_time = timed.start_time
            keeper.end_time = timed.end_time
            update_fields.extend(["start_time", "end_time"])
        if update_fields:
            keeper.save(update_fields=update_fields)
        WorkItem.objects.filter(pk__in=[row.pk for row in rows if row.pk != keeper.pk]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("work_schedule", "0012_sheet_sync_event_statuses"),
    ]

    operations = [
        migrations.RunPython(deduplicate_training_work_items, migrations.RunPython.noop),
    ]
