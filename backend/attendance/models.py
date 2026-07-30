from django.db import models

from authentication.models import UserProfile


class AttendanceRecord(models.Model):
    employee = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="attendance_records")
    work_date = models.DateField(db_index=True)
    shift_code = models.CharField(max_length=30)
    shift_name = models.CharField(max_length=120)
    scheduled_start = models.TimeField()
    scheduled_end = models.TimeField()
    expected_minutes = models.PositiveIntegerField(default=480)
    clock_in = models.DateTimeField()
    clock_out = models.DateTimeField(blank=True, null=True)
    note = models.CharField(max_length=500, blank=True, default="")
    clock_in_ip = models.CharField(max_length=64, blank=True, default="")
    clock_out_ip = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-work_date", "-clock_in"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "work_date", "shift_code"], name="unique_employee_daily_shift"),
        ]
        indexes = [
            models.Index(fields=["employee", "work_date"], name="attendance_employee_date_idx"),
        ]

    def __str__(self):
        return f"{self.employee_id} · {self.work_date} · {self.shift_name}"
