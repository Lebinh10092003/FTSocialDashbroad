from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from authentication.models import UserProfile, WorkspaceNotification

from .models import TrainingPartner


class TrainingSessionNotificationTests(TestCase):
    def setUp(self):
        self.manager = UserProfile.objects.create(
            email="manager@fermat.vn",
            name="Quản lý Đào tạo",
            role="MANAGER",
            employment_status="ACTIVE",
            access_modules=["digital-training"],
        )
        django_user = User.objects.create_user(
            username=self.manager.email,
            email=self.manager.email,
            password="test-password",
        )
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {Token.objects.create(user=django_user).key}")
        self.instructor = UserProfile.objects.create(
            email="giangvien@fermat.vn",
            name="Ngô Thị Liên",
            role="EMPLOYEE",
            employment_status="ACTIVE",
        )
        self.old_support = UserProfile.objects.create(
            email="hotro-cu@fermat.vn",
            name="Nguyễn Thanh Phong",
            role="EMPLOYEE",
            employment_status="ACTIVE",
        )
        self.new_support = UserProfile.objects.create(
            email="hotro-moi@fermat.vn",
            name="Đàm Khánh Hà",
            role="EMPLOYEE",
            employment_status="ACTIVE",
        )
        self.partner = TrainingPartner.objects.create(name="TH Kim Đồng")

    def _payload(self, session_date):
        return {
            "title": "Buổi 3 · TH Kim Đồng",
            "session_number": 3,
            "date": session_date.isoformat(),
            "start_time": "07:30",
            "end_time": "10:30",
            "partner_id": self.partner.pk,
            "contents": ["Ứng dụng AI trong giảng dạy"],
            "attendees": 30,
            "instructor_name": self.instructor.name,
            "support_staff_name": self.old_support.name,
            "status": "planned",
        }

    def test_future_session_create_and_changes_notify_every_related_staff_member(self):
        response = self.client.post(
            "/api/digital-training/sessions",
            self._payload(timezone.localdate() + timedelta(days=5)),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        session_id = response.data["id"]
        created = WorkspaceNotification.objects.get(event_key__endswith=":created")
        self.assertEqual(
            set(created.target_emails),
            {self.instructor.email, self.old_support.email},
        )
        self.assertEqual(created.action_url, f"/digital-training/calendar/training/{session_id}")
        self.assertIn("Buổi 3, TH Kim Đồng", created.message)

        response = self.client.patch(
            f"/api/digital-training/sessions/{session_id}",
            {
                "start_time": "08:15",
                "end_time": "11:45",
                "support_staff_name": self.new_support.name,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        changed = WorkspaceNotification.objects.get(event_key__endswith=":time-changed")
        staff_changed = WorkspaceNotification.objects.get(event_key__endswith=":staff-changed")
        expected = {self.instructor.email, self.old_support.email, self.new_support.email}
        self.assertEqual(set(changed.target_emails), expected)
        self.assertEqual(set(staff_changed.target_emails), expected)
        self.assertIn("08:15", changed.message)
        self.assertIn("Đàm Khánh Hà", staff_changed.message)
        self.assertIn("Nguyễn Thanh Phong → Đàm Khánh Hà", staff_changed.message)

    def test_past_session_does_not_create_notification(self):
        response = self.client.post(
            "/api/digital-training/sessions",
            self._payload(timezone.localdate() - timedelta(days=1)),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(WorkspaceNotification.objects.filter(category="digital-training").exists())
