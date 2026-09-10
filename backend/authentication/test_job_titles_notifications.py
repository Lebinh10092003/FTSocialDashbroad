from django.test import TestCase
from rest_framework.test import APIClient

from .models import JobTitle, UserProfile, WorkspaceNotification


class JobTitleAndNotificationTests(TestCase):
    def setUp(self):
        self.admin = UserProfile.objects.create(email="admin@example.test", name="Admin", role="ADMIN")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_admin_can_create_disable_restore_and_delete_unused_title(self):
        response = self.client.post("/api/auth/job-titles", {"name": "Điều phối viên"}, format="json")
        self.assertEqual(response.status_code, 201)
        title_id = response.data["item"]["id"]
        self.assertEqual(self.client.delete(f"/api/auth/job-titles/{title_id}").status_code, 200)
        self.assertFalse(JobTitle.objects.get(pk=title_id).is_active)
        self.assertEqual(self.client.patch(f"/api/auth/job-titles/{title_id}", {"isActive": True}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/auth/job-titles/{title_id}?hard=1").status_code, 200)
        self.assertFalse(JobTitle.objects.filter(pk=title_id).exists())

    def test_title_in_use_cannot_be_hard_deleted(self):
        title = JobTitle.objects.create(name="Chức danh đang sử dụng")
        self.admin.job_title = title
        self.admin.save(update_fields=["job_title"])
        response = self.client.delete(f"/api/auth/job-titles/{title.pk}?hard=1")
        self.assertEqual(response.status_code, 409)

    def test_catalogue_change_is_visible_as_notification(self):
        self.client.post("/api/auth/job-titles", {"name": "Chuyên viên thông báo"}, format="json")
        response = self.client.get("/api/notifications")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["notifications"][0]["category"], "personnel")

    def test_notification_without_target_is_broadcast(self):
        employee = UserProfile.objects.create(email="employee@example.test", role="EMPLOYEE")
        WorkspaceNotification.objects.create(event_key="broadcast", title="Biến động Workspace", message="Nội dung")
        self.client.force_authenticate(employee)
        response = self.client.get("/api/notifications")
        self.assertEqual(response.data["notifications"][0]["title"], "Biến động Workspace")

    def test_notification_read_states_and_action_url(self):
        notification = WorkspaceNotification.objects.create(
            event_key="work-item:42",
            title="Công việc cần xử lý",
            message="Mở đúng công việc được giao.",
            category="work-schedule",
            action_url="/work-schedule/personal?task=42",
        )
        before = self.client.get("/api/notifications")
        self.assertEqual(before.data["unreadCount"], 1)
        self.assertFalse(before.data["notifications"][0]["read"])
        self.assertEqual(before.data["notifications"][0]["actionUrl"], "/work-schedule/personal?task=42")

        self.assertEqual(self.client.post(f"/api/notifications/{notification.pk}/read").status_code, 200)
        after = self.client.get("/api/notifications")
        self.assertEqual(after.data["unreadCount"], 0)
        self.assertTrue(after.data["notifications"][0]["read"])

        WorkspaceNotification.objects.create(event_key="work-item:43", title="Việc khác", message="Nội dung")
        self.assertEqual(self.client.post("/api/notifications/read-all").status_code, 200)
        self.assertEqual(self.client.get("/api/notifications").data["unreadCount"], 0)
