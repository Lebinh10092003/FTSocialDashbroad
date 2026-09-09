from django.test import TestCase
from rest_framework.test import APIClient

from .models import JobTitle, UserProfile


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
