from django.contrib import admin

from .models import AttendanceRecord


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ("employee", "work_date", "shift_name", "clock_in", "clock_out")
    list_filter = ("work_date", "shift_code")
    search_fields = ("employee__email", "employee__name")
