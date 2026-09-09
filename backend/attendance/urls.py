from django.urls import path

from . import views


urlpatterns = [
    path("attendance/records", views.attendance_records, name="attendance_records"),
    path("attendance/clock", views.attendance_clock, name="attendance_clock"),
    path("attendance/timesheet", views.timesheet_list, name="timesheet_list"),
    path("attendance/timesheet/save", views.timesheet_save, name="timesheet_save"),
    path("attendance/timesheet/prefill", views.timesheet_prefill, name="timesheet_prefill"),
    path("attendance/timesheet/range", views.timesheet_range, name="timesheet_range"),
]
