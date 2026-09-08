from django.urls import path

from . import views


urlpatterns = [
    path("work-schedule/items", views.work_items, name="work_items"),
    path("work-schedule/team", views.work_team, name="work_team"),
    path("work-schedule/day", views.work_day_edit, name="work_day_edit"),
    path("work-schedule/items/batch", views.work_items_batch, name="work_items_batch"),
    path("work-schedule/items/<int:item_id>", views.work_item_detail, name="work_item_detail"),
    path("work-schedule/items/<int:item_id>/review", views.work_item_review, name="work_item_review"),
    path("work-schedule/sync", views.work_schedule_sync, name="work_schedule_sync"),
    path("work-schedule/sheet-webhook", views.work_schedule_sheet_webhook, name="work_schedule_sheet_webhook"),
]
