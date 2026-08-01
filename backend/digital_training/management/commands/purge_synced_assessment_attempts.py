from django.core.management.base import BaseCommand
from django.utils import timezone

from digital_training.models import TrainingAssessmentAttempt
from digital_training.assessment_service import append_assessment_deletion_log


class Command(BaseCommand):
    help = "Delete temporary assessment attempts after successful Google Sheets sync and retention expiry."

    def handle(self, *args, **options):
        queryset = TrainingAssessmentAttempt.objects.select_related("assessment").filter(
            sync_status="synced",
            purge_after__isnull=False,
            purge_after__lte=timezone.now(),
        )
        deleted = 0
        for attempt in queryset.iterator():
            try:
                append_assessment_deletion_log(attempt, "System", "Xoa tu dong", "Het thoi han luu tam 7 ngay.")
            except Exception as error:
                self.stderr.write(f"Skip {attempt.pk}: cannot write deletion log: {error}")
                continue
            attempt.delete()
            deleted += 1
        self.stdout.write(self.style.SUCCESS(f"Purged {deleted} synced assessment attempt(s)."))
