from django.contrib import admin

from .models import AttendanceRecord, TimesheetEditLog, TimesheetEntry


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ("employee", "work_date", "shift_name", "clock_in", "clock_out")
    list_filter = ("work_date", "shift_code")
    search_fields = ("employee__email", "employee__name")


@admin.register(TimesheetEntry)
class TimesheetEntryAdmin(admin.ModelAdmin):
    list_display = ("employee", "work_date", "shift_number", "shift_start", "shift_end", "work_mode", "is_day_off", "worked_minutes")
    list_filter = ("work_date", "work_mode", "is_day_off")
    search_fields = ("employee__email", "employee__name")


@admin.register(TimesheetEditLog)
class TimesheetEditLogAdmin(admin.ModelAdmin):
    list_display = ("employee", "work_date", "edited_by", "note", "created_at")
    list_filter = ("work_date",)
    search_fields = ("employee__email", "edited_by__email", "note")
