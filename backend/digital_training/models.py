from django.db import models

class TrainingSession(models.Model):
    title = models.CharField(max_length=255)
    session_date = models.DateField()
    partner = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=255, blank=True)
    attendees = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["session_date", "title"]
