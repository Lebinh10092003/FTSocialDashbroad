import io
import json
import os
import tempfile
import time
from pathlib import Path
from django.core.management import call_command
from django.utils import timezone
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from authentication.models import UserProfile
from .models import TrainingPartner, TrainingAssessment, TrainingAssessmentAttempt, TrainingAssessmentUpload
from .assessment_storage import PREFIX, safe_answer_path

class AssessmentMaintenanceTests(TestCase):
    def setUp(self):
        self.manager = UserProfile.objects.create(email="editor@example.test", name="Editor", role="MANAGER", access_modules=["digital-training"])
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        self.assessment = TrainingAssessment.objects.create(title="Test", partner=TrainingPartner.objects.create(name="Test"), questions=[
            {"id": "q1", "variant": "Đề 1", "order": 1, "type": "short_answer", "text": "First", "correct_answers": ["1"], "points": 1},
            {"id": "q2", "variant": "Đề 2", "order": 1, "type": "short_answer", "text": "Other", "correct_answers": ["2"], "points": 1},
        ])
        self.url = f"/api/digital-training/assessment-previews/{self.assessment.public_slug}"

    def test_creator_edits_one_question_and_preserves_other_variant(self):
        preview = self.client.get(self.url + "?role=creator&variant=Đề 1")
        self.assertEqual(preview.status_code, 200)
        original = preview.data["questions"][0]
        other = self.assessment.questions[1]
        response = self.client.patch(self.url, {"original": original, "question": {**original, "text": "Edited", "variant": "HACK"}}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assessment.refresh_from_db()
        self.assertEqual(self.assessment.questions[0]["text"], "Edited")
        self.assertEqual(self.assessment.questions[0]["variant"], "Đề 1")
        self.assertEqual(self.assessment.questions[1], other)

    def test_stale_question_rejected(self):
        original = self.assessment.questions[0].copy()
        self.assessment.questions[0]["text"] = "Changed elsewhere"
        self.assessment.save()
        response = self.client.patch(self.url, {"original": original, "question": original}, format="json")
        self.assertEqual(response.status_code, 409)

    def test_anonymous_cannot_edit_or_read_preview(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.patch(self.url, {}, format="json").status_code, [401, 403])
        self.assertIn(self.client.get(self.url + "?role=creator").status_code, [401, 403])

    def test_cleanup_preserves_live_recent_and_direct_links(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, override_settings(MEDIA_ROOT=folder):
            root = Path(folder) / PREFIX
            root.mkdir(parents=True)
            for name in ["orphan.png", "live.png", "linked.png", "recent.png"]:
                (root / name).write_bytes(b"test")
                if name != "recent.png":
                    os.utime(root / name, (time.time() - 90000, time.time() - 90000))
            attempt = TrainingAssessmentAttempt.objects.create(assessment=self.assessment, respondent_name="Test", expires_at=timezone.now(), variant="Đề 1", answers={"q1": {"upload_url": "/uploads/" + PREFIX + "linked.png"}})
            TrainingAssessmentUpload.objects.create(attempt=attempt, question_id="q1", file=PREFIX + "live.png", original_name="live.png")
            output = io.StringIO()
            call_command("cleanup_assessment_uploads", stdout=output)
            self.assertEqual(json.loads(output.getvalue())["orphan_files_older_than_24h"], 1)
            self.assertTrue((root / "orphan.png").exists())
            call_command("cleanup_assessment_uploads", delete=True, stdout=io.StringIO())
            self.assertFalse((root / "orphan.png").exists())
            for name in ["live.png", "linked.png", "recent.png"]:
                self.assertTrue((root / name).exists())
            self.assertIsNone(safe_answer_path(PREFIX + "../../outside.png"))

    def test_cascade_removes_file_after_commit(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, override_settings(MEDIA_ROOT=folder):
            root = Path(folder) / PREFIX
            root.mkdir(parents=True)
            path = root / "deleted.png"
            path.write_bytes(b"test")
            attempt = TrainingAssessmentAttempt.objects.create(assessment=self.assessment, respondent_name="Test", expires_at=timezone.now(), variant="Đề 1")
            TrainingAssessmentUpload.objects.create(attempt=attempt, question_id="q1", file=PREFIX + "deleted.png", original_name="deleted.png")
            with self.captureOnCommitCallbacks(execute=True):
                self.assessment.delete()
                self.assertTrue(path.exists())
            self.assertFalse(path.exists())
            self.assertFalse(TrainingAssessmentAttempt.objects.exists())
            self.assertFalse(TrainingAssessmentUpload.objects.exists())


    def test_rollback_keeps_upload_file(self):
        from django.db import transaction
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, override_settings(MEDIA_ROOT=folder):
            path = Path(folder) / PREFIX / "rollback.png"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"test")
            attempt = TrainingAssessmentAttempt.objects.create(assessment=self.assessment, respondent_name="Test", expires_at=timezone.now(), variant="V1")
            upload = TrainingAssessmentUpload.objects.create(attempt=attempt, question_id="q1", file=PREFIX + "rollback.png", original_name="rollback.png")
            with self.captureOnCommitCallbacks(execute=True):
                try:
                    with transaction.atomic():
                        upload.delete()
                        raise ValueError("rollback")
                except ValueError:
                    pass
            self.assertTrue(path.exists())
            self.assertEqual(TrainingAssessmentUpload.objects.count(), 1)
