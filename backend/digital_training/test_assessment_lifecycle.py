import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import UserProfile, WorkspaceNotification
from .assessment_lifecycle import lifecycle_warning
from .assessment_service import _sheet_attempt_row
from .models import TrainingAssessment, TrainingAssessmentAttempt, TrainingPartner


class AssessmentLifecycleTests(TestCase):
    def setUp(self):
        self.admin = UserProfile.objects.create(email="admin@example.test", name="Admin", role="ADMIN", access_modules=[])
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.partner = TrainingPartner.objects.create(name="THCS Chu Văn An")
        self.assessment = TrainingAssessment.objects.create(
            title="Bài kiểm tra cuối khóa", partner=self.partner, status="closed",
            closed_at=timezone.now() - timedelta(days=14),
            questions=[{"id": "q1", "variant": "Đề 1", "order": 1, "type": "short_answer", "text": "Câu hỏi", "points": 1}],
        )
        self.attempt = TrainingAssessmentAttempt.objects.create(
            assessment=self.assessment, respondent_name="Học viên", variant="Đề 1",
            answers={"q1": "Trả lời"}, progress={"q1": True}, grading_notes=[{"content": "Ghi chú"}],
            manual_grading_required=True, status="submitted", expires_at=timezone.now(), submitted_at=timezone.now(),
        )

    def test_warning_milestones_and_countdown(self):
        warning = lifecycle_warning(self.assessment)
        self.assertEqual(warning["label"], "Hãy chấm bài")
        self.assessment.closed_at = timezone.now() - timedelta(days=21)
        self.assertEqual(lifecycle_warning(self.assessment)["remaining"], 9)
        self.assessment.closed_at = timezone.now() - timedelta(days=28)
        self.assertIn("2 ngày", lifecycle_warning(self.assessment)["label"])

    def test_draft_delete_is_recoverable_for_three_days(self):
        draft = TrainingAssessment.objects.create(title="Nháp", partner=self.partner)
        response = self.client.delete(f"/api/digital-training/assessments/{draft.pk}", {}, format="json")
        self.assertEqual(response.status_code, 202)
        draft.refresh_from_db()
        self.assertIsNotNone(draft.trashed_at)
        self.assertAlmostEqual((draft.purge_at - draft.trashed_at).total_seconds(), 3 * 86400, delta=2)
        response = self.client.post(f"/api/digital-training/assessments-trash/{draft.pk}/restore", {}, format="json")
        self.assertEqual(response.status_code, 200)
        draft.refresh_from_db()
        self.assertIsNone(draft.trashed_at)

    def test_sheet_attempt_row_contains_complete_json(self):
        row = _sheet_attempt_row(self.attempt, self.assessment.questions)
        payload = json.loads(row[-1])
        self.assertEqual(payload["answers"], {"q1": "Trả lời"})
        self.assertEqual(payload["grading_notes"][0]["content"], "Ghi chú")

    def test_notification_targets_digital_training_users(self):
        WorkspaceNotification.objects.create(
            event_key="test-warning", title="Hãy chấm bài", message="Kiểm tra",
            target_modules=["digital-training"],
        )
        response = self.client.get("/api/notifications")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["unreadCount"], 1)
