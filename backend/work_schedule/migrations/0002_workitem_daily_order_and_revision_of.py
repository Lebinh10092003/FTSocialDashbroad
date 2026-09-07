import django.db.models.deletion
from django.db import migrations, models


def number_daily_items(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    current_group = None
    order = 0
    rows = WorkItem.objects.order_by("executor_id", "work_date", "start_time", "created_at", "pk")
    for item in rows.iterator():
        group = (item.executor_id, item.work_date)
        if group != current_group:
            current_group = group
            order = 0
        order += 1
        if item.daily_order != order:
            WorkItem.objects.filter(pk=item.pk).update(daily_order=order)


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="workitem",
            name="daily_order",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="workitem",
            name="revision_of",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="revision_items",
                to="work_schedule.workitem",
            ),
        ),
        migrations.RunPython(number_daily_items, migrations.RunPython.noop),
        migrations.AlterModelOptions(
            name="workitem",
            options={"ordering": ["work_date", "daily_order", "start_time", "created_at"]},
        ),
    ]
