from django.urls import path

from . import views


urlpatterns = [
    path("attendance/records", views.attendance_records, name="attendance_records"),
    path("attendance/clock", views.attendance_clock, name="attendance_clock"),
]
