import json
import time
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand
from digital_training.assessment_storage import PREFIX, referenced_names, safe_answer_path, delete_unreferenced_answer
from digital_training.models import TrainingAssessment, TrainingAssessmentAttempt, TrainingAssessmentUpload

class Command(BaseCommand):
    help = "Audit local orphan assessment uploads; --delete removes only unreferenced files older than 24 hours."

    def add_arguments(self, parser):
        parser.add_argument("--delete", action="store_true")

    def handle(self, *args, **options):
        media = Path(settings.MEDIA_ROOT).resolve()
        root = media / PREFIX
        names, text = referenced_names()
        candidates = []
        scanned_bytes = 0
        if root.exists() and root.resolve().is_relative_to(media):
            for path in root.rglob("*"):
                if not path.is_file() or path.is_symlink():
                    continue
                name = path.relative_to(media).as_posix()
                safe = safe_answer_path(name)
                if not safe:
                    continue
                size = path.stat().st_size
                scanned_bytes += size
                if name not in names and name not in text and path.stat().st_mtime < time.time() - 86400:
                    candidates.append((name, size))
        removed_bytes = 0
        removed_files = 0
        if options["delete"]:
            for name, size in candidates:
                if delete_unreferenced_answer(name):
                    removed_bytes += size
                    removed_files += 1
        self.stdout.write(json.dumps({
            "assessment_ids": list(TrainingAssessment.objects.order_by("id").values_list("id", flat=True)),
            "attempts": TrainingAssessmentAttempt.objects.count(),
            "upload_records": TrainingAssessmentUpload.objects.count(),
            "local_answer_bytes": scanned_bytes,
            "orphan_files_older_than_24h": len(candidates),
            "orphan_bytes": sum(size for _, size in candidates),
            "deleted_files": removed_files, "deleted_bytes": removed_bytes,
        }))
