import uuid

from django.db import migrations, models


def assign_sync_uids(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    for item in WorkItem.objects.all().iterator():
        if item.source_sheet_row and item.source_task_index:
            value = uuid.UUID(f"6ae71379-0000-5000-8000-{item.source_sheet_row:06x}{item.source_task_index:06x}")
        else:
            value = uuid.uuid4()
        WorkItem.objects.filter(pk=item.pk).update(sync_uid=value)


def queue_existing_groups(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    Change = apps.get_model("work_schedule", "WorkScheduleSheetChange")
    groups = WorkItem.objects.values_list("executor_id", "work_date").distinct()
    Change.objects.bulk_create([
        Change(executor_email=email, work_date=work_date) for email, work_date in groups
    ])


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0006_reconcile_ft_sheet_initial_snapshot")]
    operations = [
        migrations.AddField(
            model_name="workitem",
            name="sync_uid",
            field=models.UUIDField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="workitem",
            name="source_sync_hash",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.RunPython(assign_sync_uids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="workitem",
            name="sync_uid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.CreateModel(
            name="WorkScheduleSheetChange",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("executor_email", models.EmailField(db_index=True, max_length=254)),
                ("work_date", models.DateField(db_index=True)),
                ("status", models.CharField(choices=[("pending", "Chờ đồng bộ"), ("processing", "Đang đồng bộ"), ("done", "Đã đồng bộ"), ("failed", "Lỗi"), ("conflict", "Xung đột")], db_index=True, default="pending", max_length=20)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("last_error", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("processed_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ["created_at", "pk"]},
        ),
        migrations.CreateModel(
            name="WorkScheduleSheetSyncLease",
            fields=[
                ("key", models.CharField(default="ft-work-schedule", max_length=40, primary_key=True, serialize=False)),
                ("locked_until", models.DateTimeField(blank=True, null=True)),
            ],
        ),
        migrations.RunPython(queue_existing_groups, migrations.RunPython.noop),
    ]
