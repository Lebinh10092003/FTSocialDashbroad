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


class TimesheetEntry(models.Model):
    WORK_MODE_CHOICES = [
        ("direct", "Trực tiếp"),
        ("online", "Online"),
    ]
    employee = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="timesheet_entries")
    work_date = models.DateField(db_index=True)
    shift_number = models.PositiveSmallIntegerField(default=1)
    shift_start = models.TimeField()
    shift_end = models.TimeField()
    crosses_midnight = models.BooleanField(default=False)
    work_mode = models.CharField(max_length=10, choices=WORK_MODE_CHOICES, default="direct")
    is_day_off = models.BooleanField(default=False)
    notes = models.CharField(max_length=500, blank=True, default="")
    worked_minutes = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-work_date", "shift_number"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "work_date", "shift_number"], name="unique_employee_date_shift"),
        ]
        indexes = [
            models.Index(fields=["employee", "work_date"], name="timesheet_employee_date_idx"),
        ]

    def save(self, *args, **kwargs):
        if self.is_day_off:
            self.worked_minutes = 0
        else:
            start_mins = self.shift_start.hour * 60 + self.shift_start.minute
            end_mins = self.shift_end.hour * 60 + self.shift_end.minute
            if end_mins <= start_mins:
                self.crosses_midnight = True
                self.worked_minutes = (24 * 60 - start_mins) + end_mins
            else:
                self.crosses_midnight = False
                self.worked_minutes = end_mins - start_mins
        super().save(*args, **kwargs)

    def __str__(self):
        if self.is_day_off:
            return f"{self.employee_id} · {self.work_date} · Nghỉ"
        return f"{self.employee_id} · {self.work_date} · Ca {self.shift_number} ({self.shift_start.strftime('%H:%M')}-{self.shift_end.strftime('%H:%M')})"


class TimesheetEditLog(models.Model):
    employee = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="timesheet_edit_logs")
    work_date = models.DateField()
    edited_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, related_name="timesheet_edits_made")
    note = models.CharField(max_length=1000)
    old_data = models.JSONField(default=dict, blank=True)
    new_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["employee", "work_date"], name="editlog_employee_date_idx"),
        ]

    def __str__(self):
        return f"{self.employee_id} · {self.work_date} · by {self.edited_by_id}"
