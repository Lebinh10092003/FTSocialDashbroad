from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0001_initial"),
        ("attendance", "0002_timesheetentry"),
    ]

    operations = [
        migrations.CreateModel(
            name="TimesheetEditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("work_date", models.DateField()),
                ("note", models.CharField(max_length=1000)),
                ("old_data", models.JSONField(blank=True, default=dict)),
                ("new_data", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("edited_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="timesheet_edits_made", to="authentication.userprofile")),
                ("employee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="timesheet_edit_logs", to="authentication.userprofile")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="timesheeteditlog",
            index=models.Index(fields=["employee", "work_date"], name="editlog_employee_date_idx"),
        ),
    ]
