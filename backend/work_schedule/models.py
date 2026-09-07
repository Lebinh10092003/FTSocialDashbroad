from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from authentication.models import UserProfile


class WorkItem(models.Model):
    STATUS_TODO = "todo"
    STATUS_DOING = "doing"
    STATUS_COMPLETED = "completed"
    STATUS_REVIEWED = "reviewed"
    STATUS_CHOICES = [
        (STATUS_TODO, "Cần làm"),
        (STATUS_DOING, "Đang thực hiện"),
        (STATUS_COMPLETED, "Đã hoàn thành"),
        (STATUS_REVIEWED, "Đã review"),
    ]
    PRIORITY_CHOICES = [("low", "Thấp"), ("medium", "Vừa"), ("high", "Cao")]

    creator = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="created_work_items")
    executor = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="assigned_work_items")
    supporters = models.ManyToManyField(UserProfile, blank=True, related_name="supported_work_items")
    managers = models.ManyToManyField(UserProfile, blank=True, related_name="managed_work_items")
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    progress_note = models.CharField(max_length=1000, blank=True, default="")
    work_date = models.DateField(db_index=True)
    start_time = models.TimeField(blank=True, null=True)
    end_time = models.TimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_TODO, db_index=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="medium")
    label = models.CharField(max_length=100, blank=True, default="Công việc")
    daily_order = models.PositiveIntegerField(default=1)
    needs_revision = models.BooleanField(default=False)
    revision_count = models.PositiveIntegerField(default=0)
    revision_of = models.ForeignKey(
        "self", blank=True, null=True, on_delete=models.SET_NULL, related_name="revision_items"
    )
    training_session = models.OneToOneField(
        "digital_training.TrainingSession",
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="work_schedule_item",
    )
    review_percent = models.PositiveSmallIntegerField(
        blank=True, null=True, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    review_note = models.CharField(max_length=1000, blank=True, default="")
    source_sheet_row = models.PositiveIntegerField(blank=True, null=True)
    source_task_index = models.PositiveIntegerField(blank=True, null=True)
    source_record_id = models.CharField(max_length=100, blank=True, default="")
    reviewed_by = models.ForeignKey(
        UserProfile, blank=True, null=True, on_delete=models.SET_NULL, related_name="reviewed_work_items"
    )
    reviewed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["work_date", "daily_order", "start_time", "created_at"]
        indexes = [
            models.Index(fields=["executor", "work_date", "status"], name="work_executor_date_status_idx"),
            models.Index(fields=["creator", "work_date"], name="work_creator_date_idx"),
        ]

    def __str__(self):
        return f"{self.work_date} · {self.title}"
