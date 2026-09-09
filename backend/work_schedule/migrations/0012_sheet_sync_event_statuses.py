from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("work_schedule", "0011_workschedulesheetinboundevent"),
    ]

    operations = [
        migrations.AlterField(
            model_name="workschedulesheetinboundevent",
            name="status",
            field=models.CharField(
                choices=[
                    ("processing", "Đang xử lý"),
                    ("processed", "Đã xử lý"),
                    ("skipped", "Bỏ qua do đang đồng bộ"),
                    ("failed", "Lỗi"),
                ],
                db_index=True,
                max_length=20,
            ),
        ),
    ]
