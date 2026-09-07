from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile

from .models import WorkItem


class WorkScheduleApiTests(TestCase):
    def profile(self, email, role="EMPLOYEE"):
        user = get_user_model().objects.create_user(username=email, email=email, password="StrongPassword9921")
        profile = UserProfile.objects.create(email=email, name=email.split("@", 1)[0], role=role, access_modules=[])
        return profile, Token.objects.create(user=user).key

    def request(self, token, method, path, payload=None):
        return getattr(self.client, method)(
            path, payload or {}, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}"
        )

    def setUp(self):
        self.executor, self.executor_token = self.profile("executor@example.com")
        self.supporter, self.supporter_token = self.profile("supporter@example.com")
        self.manager, self.manager_token = self.profile("manager@example.com", "MANAGER")

    def create_item(self):
        response = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Hoàn thiện báo cáo",
            "date": "2026-09-07",
            "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email],
            "managerEmails": [self.manager.email],
            "priority": "high",
        })
        self.assertEqual(response.status_code, 201, response.data)
        return response.json()["item"]

    def test_item_is_visible_with_relationship_specific_titles(self):
        item = self.create_item()
        executor = self.request(self.executor_token, "get", "/api/work-schedule/items").json()["items"][0]
        supporter = self.request(self.supporter_token, "get", "/api/work-schedule/items").json()["items"][0]
        self.assertEqual(executor["displayTitle"], "Hoàn thiện báo cáo")
        self.assertEqual(supporter["displayTitle"], "Hỗ trợ/theo dõi: Hoàn thiện báo cáo")
        self.assertEqual(item["executor"]["email"], self.executor.email)

    def test_manager_revision_keeps_completed_item_and_creates_next_day_item(self):
        item = self.create_item()
        completed = self.request(self.executor_token, "patch", f"/api/work-schedule/items/{item['id']}", {
            "title": item["title"], "date": item["date"], "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email], "managerEmails": [self.manager.email], "status": "completed",
        })
        self.assertEqual(completed.status_code, 200, completed.data)
        manager_view = self.request(self.manager_token, "get", "/api/work-schedule/items").json()["items"][0]
        self.assertEqual(manager_view["displayStatus"], "todo")
        self.assertTrue(manager_view["displayTitle"].startswith("Kiểm tra kết quả công việc:"))

        revise = self.request(self.manager_token, "post", f"/api/work-schedule/items/{item['id']}/review", {
            "action": "request_revision", "reviewPercent": 70, "reviewNote": "Bổ sung số liệu",
        })
        self.assertEqual(revise.status_code, 200, revise.data)
        rows = self.request(self.executor_token, "get", "/api/work-schedule/items").json()["items"]
        original = next(row for row in rows if row["id"] == item["id"])
        revision = next(row for row in rows if row["id"] != item["id"])
        self.assertEqual(original["status"], "completed")
        self.assertEqual(original["date"], "2026-09-07")
        self.assertFalse(original["canEdit"])
        self.assertFalse(original["canReview"])
        self.assertEqual(revision["status"], "doing")
        self.assertEqual(revision["date"], "2026-09-08")
        self.assertEqual(revision["revisionOfId"], item["id"])
        self.assertTrue(revision["displayTitle"].startswith("Bổ sung:"))

        WorkItem.objects.filter(pk=revision["id"]).update(status="completed")
        confirm = self.request(self.manager_token, "post", f"/api/work-schedule/items/{revision['id']}/review", {
            "action": "confirm", "reviewPercent": 100,
        })
        self.assertEqual(confirm.status_code, 200, confirm.data)
        self.assertEqual(confirm.json()["item"]["status"], "reviewed")

    def test_items_are_numbered_per_executor_and_date_and_renumber_after_move(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Việc thứ hai", "date": "2026-09-07", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        self.assertEqual(first["dailyOrder"], 1)
        self.assertEqual(second["dailyOrder"], 2)

        moved = self.request(self.executor_token, "patch", f"/api/work-schedule/items/{first['id']}", {
            "title": first["title"], "date": "2026-09-08", "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email], "managerEmails": [self.manager.email], "status": "todo",
        })
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(moved.json()["item"]["dailyOrder"], 1)
        self.assertEqual(WorkItem.objects.get(pk=second["id"]).daily_order, 1)

    def test_delete_requires_no_password_and_batch_status_is_supported(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Việc cá nhân", "date": "2026-09-07", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        batch = self.request(self.executor_token, "post", "/api/work-schedule/items/batch", {
            "ids": [second["id"]], "action": "status", "status": "doing",
        })
        self.assertEqual(batch.status_code, 200, batch.data)
        self.assertEqual(WorkItem.objects.get(pk=second["id"]).status, "doing")
        deleted = self.request(self.manager_token, "delete", f"/api/work-schedule/items/{first['id']}")
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertFalse(WorkItem.objects.filter(pk=first["id"]).exists())
