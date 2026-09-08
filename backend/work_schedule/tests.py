import os
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile

from .models import WorkItem, WorkScheduleSheetChange, WorkScheduleSheetInboundEvent
from .sheet_parser import assessment_notes, parse_sheet_tasks, status_from_note, training_end
from .sheet_sync import EMPLOYEE_EMAILS, _group_values, _row_hash, deterministic_sheet_uid
from .training_sync import sync_work_item_from_training


class WorkScheduleSheetParserTests(TestCase):
    def test_sheet_identity_and_hash_are_stable_when_title_is_not_the_identity(self):
        self.assertEqual(str(deterministic_sheet_uid(1094, 1)), "6ae71379-0000-5000-8000-000446000001")
        self.assertEqual(_row_hash("a", "b", "c", "d"), "eb564109")

    def test_sheet_output_omits_open_statuses_and_empty_leader_reviews(self):
        class Item:
            def __init__(self, status, note="", review_percent=None):
                self.title = status
                self.start_time = None
                self.status = status
                self.progress_note = note
                self.review_percent = review_percent
                self.review_note = ""
                self.sync_uid = deterministic_sheet_uid(1094, 1 if status == "todo" else 2)

        _, self_notes, leader_notes, _ = _group_values([
            Item("todo"), Item("doing"), Item("completed"), Item("doing", "Đang chờ khách phản hồi")
        ])
        self.assertEqual(self_notes, "3. Hoàn thành\n4. Đang chờ khách phản hồi")
        self.assertEqual(leader_notes, "")

        _, completed_notes, leader_notes, _ = _group_values([
            Item("completed"), Item("reviewed")
        ])
        self.assertEqual(completed_notes, "Hoàn thành")
        self.assertEqual(leader_notes, "2. Hoàn thành")

        _, _, all_reviewed_notes, _ = _group_values([
            Item("reviewed"), Item("reviewed", review_percent=90)
        ])
        self.assertEqual(all_reviewed_notes, "Hoàn thành")

    def test_numbered_cell_keeps_wrapped_lines_and_accepts_duplicate_numbers(self):
        tasks = parse_sheet_tasks(
            "1. Nhiệm vụ đầu\nphần mô tả xuống dòng\n2. Nhiệm vụ hai\n2. 17h30: Tập huấn GCE1"
        )
        self.assertEqual([task.title for task in tasks], [
            "Nhiệm vụ đầu phần mô tả xuống dòng",
            "Nhiệm vụ hai",
            "Tập huấn GCE1",
        ])
        self.assertEqual(tasks[-1].start_time.isoformat(timespec="minutes"), "17:30")
        self.assertEqual(training_end(tasks[-1].start_time).isoformat(timespec="minutes"), "20:30")

    def test_assessment_is_aligned_by_occurrence_and_custom_note_does_not_complete(self):
        notes = assessment_notes("1. Đang chờ ký\n2. Hoàn thành", 3)
        self.assertEqual(notes, ["Đang chờ ký", "Hoàn thành", ""])
        self.assertEqual(status_from_note(notes[0], False), "doing")
        self.assertEqual(status_from_note(notes[1], False), "completed")
        self.assertEqual(status_from_note("", True), "todo")
        self.assertEqual(assessment_notes("2. Hoàn thành", 3), ["", "Hoàn thành", ""])


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
        manager = self.request(self.manager_token, "get", "/api/work-schedule/items").json()["items"][0]
        self.assertEqual(executor["displayTitle"], "Hoàn thiện báo cáo")
        self.assertEqual(supporter["displayTitle"], "Hỗ trợ/theo dõi: Hoàn thiện báo cáo")
        self.assertEqual(manager["displayTitle"], "Quản lý: Hoàn thiện báo cáo")
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

    def test_web_changes_are_added_to_sheet_outbox(self):
        self.create_item()
        self.assertTrue(WorkScheduleSheetChange.objects.filter(
            executor_email=self.executor.email,
            work_date="2026-09-07",
            status=WorkScheduleSheetChange.STATUS_PENDING,
        ).exists())

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

    def test_progress_note_can_be_updated_independently_in_any_status(self):
        item = self.create_item()
        WorkItem.objects.filter(pk=item["id"]).update(status="reviewed", reviewed_at=timezone.now())
        response = self.request(self.executor_token, "patch", f"/api/work-schedule/items/{item['id']}", {
            "progressNote": "Đang chờ Ms Phương xác nhận bản in",
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["item"]["progressNote"], "Đang chờ Ms Phương xác nhận bản in")

    def test_day_table_edit_keeps_status_and_creates_numbered_new_task(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Nhiệm vụ đã hoàn thành", "date": "2026-09-07",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
            "status": "completed",
        }).json()["item"]

        response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": "2026-09-07",
            "items": [
                {"id": first["id"], "title": "Hoàn thiện báo cáo đã sửa", "progressNote": "Đang chờ duyệt"},
                {"id": second["id"], "title": second["title"], "progressNote": "Đã gửi bản chính"},
                {"title": "Nhiệm vụ nhập từ dòng số 3", "progressNote": ""},
            ],
        })
        self.assertEqual(response.status_code, 200, response.data)
        first_row = WorkItem.objects.get(pk=first["id"])
        second_row = WorkItem.objects.get(pk=second["id"])
        new_row = WorkItem.objects.get(title="Nhiệm vụ nhập từ dòng số 3", executor=self.executor)
        self.assertEqual(first_row.status, "todo")
        self.assertEqual(first_row.progress_note, "Đang chờ duyệt")
        self.assertEqual(second_row.status, "completed")
        self.assertEqual(second_row.progress_note, "Đã gửi bản chính")
        self.assertEqual(new_row.status, "todo")
        self.assertEqual(new_row.executor, self.executor)
        self.assertEqual(new_row.daily_order, 3)


    def test_batch_date_and_people_assignment_are_supported(self):
        first = self.create_item()
        second = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Việc thứ hai", "date": "2026-09-07", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [self.manager.email],
        }).json()["item"]
        moved = self.request(self.manager_token, "post", "/api/work-schedule/items/batch", {
            "ids": [first["id"], second["id"]], "action": "date", "date": "2026-09-09",
        })
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertFalse(WorkItem.objects.filter(id__in=[first["id"], second["id"]]).exclude(work_date="2026-09-09").exists())

        observer, _ = self.profile("observer@example.com")
        assigned = self.request(self.manager_token, "post", "/api/work-schedule/items/batch", {
            "ids": [first["id"], second["id"]], "action": "add_supporters", "emails": [observer.email],
        })
        self.assertEqual(assigned.status_code, 200, assigned.data)
        self.assertEqual(WorkItem.objects.filter(id__in=[first["id"], second["id"]], supporters=observer).count(), 2)

        added_manager = self.request(self.executor_token, "post", "/api/work-schedule/items/batch", {
            "ids": [first["id"], second["id"]], "action": "add_managers", "emails": [observer.email],
        })
        self.assertEqual(added_manager.status_code, 200, added_manager.data)
        self.assertEqual(WorkItem.objects.filter(id__in=[first["id"], second["id"]], managers=observer).count(), 2)

    def test_training_schedule_syncs_both_ways_with_three_hour_duration(self):
        response = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Tập huấn B1 TH Trung Văn", "date": "2026-09-15",
            "startTime": "17:00", "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email], "managerEmails": [self.manager.email],
            "label": "Tập huấn",
        })
        self.assertEqual(response.status_code, 201, response.data)
        item = WorkItem.objects.select_related("training_session").get(pk=response.json()["item"]["id"])
        self.assertIsNotNone(item.training_session_id)
        self.assertEqual(item.end_time.isoformat(timespec="minutes"), "20:00")
        self.assertEqual(item.training_session.end_time.isoformat(timespec="minutes"), "20:00")

        session = item.training_session
        session.session_date = "2026-09-16"
        session.status = "completed"
        session.save()
        sync_work_item_from_training(session, self.manager)
        item.refresh_from_db()
        self.assertEqual(item.work_date.isoformat(), "2026-09-16")
        self.assertEqual(item.status, "completed")

    def test_training_reference_inside_normal_task_does_not_create_session(self):
        response = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Gửi tài liệu sau tập huấn", "date": "2026-09-07",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
            "label": "Công việc",
        })
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(WorkItem.objects.get(pk=response.json()["item"]["id"]).training_session_id)

    def test_organisational_manager_views_report_only_in_team_schedule(self):
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        response = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Việc của nhân viên", "date": "2026-09-17",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        })
        self.assertEqual(response.status_code, 201, response.data)
        manager_rows = self.request(self.manager_token, "get", "/api/work-schedule/items").json()["items"]
        self.assertNotIn(response.json()["item"]["id"], [row["id"] for row in manager_rows])
        team_rows = self.request(self.manager_token, "get", "/api/work-schedule/team").json()["items"]
        row = next(item for item in team_rows if item["id"] == response.json()["item"]["id"])
        self.assertEqual(row["viewerRelation"], "team_viewer")
        self.assertEqual(row["displayTitle"], "Việc của nhân viên")
        self.assertFalse(row["canDelete"])
        self.assertFalse(row["canReview"])

    def test_team_endpoint_lists_only_direct_reports_for_manager(self):
        self.executor.manager = self.manager
        self.executor.employee_code = "FT-09"
        self.executor.save(update_fields=["manager", "employee_code"])
        response = self.request(self.manager_token, "get", "/api/work-schedule/team")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([member["email"] for member in response.json()["members"]], [self.executor.email])
        self.assertEqual(response.json()["members"][0]["employeeCode"], "FT-09")

    def test_admin_can_manage_every_employee_without_adding_manager_title(self):
        admin, admin_token = self.profile("admin@example.com", "ADMIN")
        item = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Lịch riêng của nhân viên", "date": "2026-09-18",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        admin_items = self.request(admin_token, "get", "/api/work-schedule/items").json()["items"]
        self.assertNotIn(item["id"], [row["id"] for row in admin_items])
        team = self.request(admin_token, "get", "/api/work-schedule/team").json()
        self.assertIn(self.executor.email, [member["email"] for member in team["members"]])
        admin_row = next(row for row in team["items"] if row["id"] == item["id"])
        self.assertEqual(admin_row["displayTitle"], "Lịch riêng của nhân viên")
        self.assertTrue(admin_row["canEdit"])
        self.assertTrue(admin_row["canDelete"])
        self.assertTrue(admin_row["canManagePeople"])
        self.assertEqual(self.request(admin_token, "get", f"/api/work-schedule/items/{item['id']}").status_code, 200)

        updated = self.request(admin_token, "patch", f"/api/work-schedule/items/{item['id']}", {
            "title": item["title"], "date": "2026-09-19", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [], "status": "completed",
        })
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.json()["item"]["date"], "2026-09-19")
        self.assertTrue(updated.json()["item"]["canReview"])
        reviewed = self.request(admin_token, "post", f"/api/work-schedule/items/{item['id']}/review", {
            "action": "confirm", "reviewPercent": 100,
        })
        self.assertEqual(reviewed.status_code, 200, reviewed.data)
        self.assertEqual(reviewed.json()["item"]["status"], "reviewed")

        created = self.request(admin_token, "post", "/api/work-schedule/items", {
            "title": "Admin giao việc không chỉ định quản lý", "date": "2026-09-20",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        })
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.json()["item"]["displayTitle"], "Admin giao việc không chỉ định quản lý")

    def test_executor_never_sees_manager_review_controls_or_details(self):
        item = self.create_item()
        WorkItem.objects.filter(pk=item["id"]).update(
            status="completed", review_percent=85, review_note="Cần rà soát"
        )
        executor_row = self.request(
            self.executor_token, "get", f"/api/work-schedule/items/{item['id']}"
        ).json()
        self.assertFalse(executor_row["canReview"])
        self.assertIsNone(executor_row["reviewPercent"])
        self.assertEqual(executor_row["reviewNote"], "")

        manager_row = self.request(
            self.manager_token, "get", f"/api/work-schedule/items/{item['id']}"
        ).json()
        self.assertTrue(manager_row["canReview"])
        self.assertEqual(manager_row["reviewPercent"], 85)


@mock.patch.dict(os.environ, {"SHEET_WEBHOOK_SECRET": "test-webhook-secret"})
class WorkScheduleSheetWebhookTests(TestCase):
    """NOTE: migrations 0004/0006/0009/0010 seed real historical WorkItem/WorkScheduleSheetChange
    rows (incl. for sondc@fermat.edu.vn) into every fresh test DB, so assertions here always
    scope by `source_sheet_row=ROW_NUMBER` / count deltas instead of bare exists()/get()."""

    WEBHOOK_PATH = "/api/work-schedule/sheet-webhook"
    EMPLOYEE_EMAIL = "sondc@fermat.edu.vn"
    EMPLOYEE_ID = "EMP-ABD98A8B"
    ROW_NUMBER = 5001

    def setUp(self):
        self.assertEqual(EMPLOYEE_EMAILS[self.EMPLOYEE_ID], self.EMPLOYEE_EMAIL)
        UserProfile.objects.filter(email=self.EMPLOYEE_EMAIL).delete()
        UserProfile.objects.create(email=self.EMPLOYEE_EMAIL, name="Đặng Chí Sơn", role="EMPLOYEE", access_modules=[])
        WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).delete()

    def post(self, payload, secret="test-webhook-secret"):
        headers = {"HTTP_X_SHEET_WEBHOOK_SECRET": secret} if secret is not None else {}
        return self.client.post(self.WEBHOOK_PATH, payload, content_type="application/json", **headers)

    def row_values(self, event_marker="Việc test webhook"):
        return ["Ba", "08/09/2026", "37", "Đặng Chí Sơn", f"1. {event_marker}", "", "", self.EMPLOYEE_ID, "REC-TEST-001", "", ""]

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_rejects_request_without_correct_secret(self, mock_service, mock_ensure, mock_push):
        response = self.post({"event_id": "evt-1", "row": self.ROW_NUMBER, "values": self.row_values()}, secret="wrong-secret")
        self.assertEqual(response.status_code, 401, response.content)
        response = self.post({"event_id": "evt-1", "row": self.ROW_NUMBER, "values": self.row_values()}, secret=None)
        self.assertEqual(response.status_code, 401, response.content)
        self.assertFalse(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        mock_service.assert_not_called()

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_valid_edit_creates_work_item_and_writes_task_id_back_to_sheet(self, mock_service, mock_ensure, mock_push):
        response = self.post({"event_id": "evt-2", "row": self.ROW_NUMBER, "values": self.row_values()})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["createdCount"], 1)
        self.assertEqual(body["updatedCount"], 0)
        item = WorkItem.objects.get(source_sheet_row=self.ROW_NUMBER, source_task_index=1)
        self.assertEqual(item.executor_id, self.EMPLOYEE_EMAIL)
        self.assertEqual(item.title, "Việc test webhook")
        self.assertEqual(item.work_date.isoformat(), "2026-09-08")
        mock_push.assert_called_once()
        touched_groups = mock_push.call_args.args[1]
        self.assertEqual(touched_groups, {(self.EMPLOYEE_EMAIL, item.work_date)})

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_ingesting_from_sheet_does_not_queue_a_web_to_sheet_push_back(self, mock_service, mock_ensure, mock_push):
        before = WorkScheduleSheetChange.objects.count()
        self.post({"event_id": "evt-3", "row": self.ROW_NUMBER, "values": self.row_values()})
        self.assertEqual(WorkScheduleSheetChange.objects.count(), before)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_duplicate_event_id_is_not_reprocessed(self, mock_service, mock_ensure, mock_push):
        first = self.post({"event_id": "evt-4", "row": self.ROW_NUMBER, "values": self.row_values("Việc gốc")})
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(mock_push.call_count, 1)

        retry = self.post({"event_id": "evt-4", "row": self.ROW_NUMBER, "values": self.row_values("Việc đã đổi khác (không nên áp dụng)")})
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json()["message"], "Sự kiện đã được xử lý trước đó (bỏ qua để tránh trùng lặp).")
        self.assertEqual(mock_push.call_count, 1)
        self.assertEqual(WorkItem.objects.get(source_sheet_row=self.ROW_NUMBER, source_task_index=1).title, "Việc gốc")
        self.assertEqual(WorkScheduleSheetInboundEvent.objects.filter(event_id="evt-4").count(), 1)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_rejects_payload_missing_required_fields(self, mock_service, mock_ensure, mock_push):
        response = self.post({"event_id": "evt-5", "values": self.row_values()})
        self.assertEqual(response.status_code, 400, response.content)
        mock_service.assert_not_called()

    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_push_back_failure_does_not_fail_the_webhook_or_lose_the_ingested_item(self, mock_service, mock_ensure):
        with mock.patch("work_schedule.sheet_sync.push_groups_to_sheet", side_effect=RuntimeError("Sheets API quota")):
            response = self.post({"event_id": "evt-6", "row": self.ROW_NUMBER, "values": self.row_values()})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["pushBackError"], "Sheets API quota")
        self.assertTrue(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        event = WorkScheduleSheetInboundEvent.objects.get(event_id="evt-6")
        self.assertEqual(event.status, WorkScheduleSheetInboundEvent.STATUS_PROCESSED)
        self.assertIn("Sheets API quota", event.error)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_retrying_a_failed_event_id_actually_reprocesses_instead_of_no_opping(self, mock_service, mock_ensure, mock_push):
        from .sheet_sync import _ingest_row as real_ingest_row

        call_count = {"n": 0}

        def flaky_ingest_row(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("Sheets API tạm lỗi")
            return real_ingest_row(*args, **kwargs)

        with mock.patch("work_schedule.sheet_sync._ingest_row", side_effect=flaky_ingest_row):
            first = self.post({"event_id": "evt-7", "row": self.ROW_NUMBER, "values": self.row_values()})
            self.assertEqual(first.status_code, 502, first.content)
            event = WorkScheduleSheetInboundEvent.objects.get(event_id="evt-7")
            self.assertEqual(event.status, WorkScheduleSheetInboundEvent.STATUS_FAILED)
            self.assertFalse(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())

            retry = self.post({"event_id": "evt-7", "row": self.ROW_NUMBER, "values": self.row_values()})
            self.assertEqual(retry.status_code, 200, retry.content)

        self.assertEqual(call_count["n"], 2)
        event.refresh_from_db()
        self.assertEqual(event.status, WorkScheduleSheetInboundEvent.STATUS_PROCESSED)
        self.assertTrue(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        self.assertEqual(WorkScheduleSheetInboundEvent.objects.filter(event_id="evt-7").count(), 1)
