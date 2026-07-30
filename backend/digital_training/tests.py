import io
from collections import Counter

from django.test import TestCase
from openpyxl import Workbook
from rest_framework.test import APIClient

from .assessment_service import generate_variants_from_import, parse_assessment_workbook
from .models import TrainingAssessment, TrainingClass, TrainingPartner, TrainingSession, TrainingSurvey
from .serializers import TrainingAssessmentSerializer, TrainingClassSerializer, TrainingCustomerMeetingSerializer, TrainingPartnerSerializer, TrainingSessionSerializer, TrainingSurveySerializer


class TrainingSurveySerializerTests(TestCase):
    def setUp(self):
        self.partner = TrainingPartner.objects.create(name="Khách hàng thử nghiệm")
        self.session = TrainingSession.objects.create(
            title="Buổi tập huấn thử nghiệm",
            partner=self.partner.name,
            partner_ref=self.partner,
            status="planned",
        )

    def test_creating_training_session_does_not_create_survey(self):
        TrainingSession.objects.create(title="Lịch mới", status="planned")

        self.assertEqual(TrainingSurvey.objects.count(), 0)

    def test_manual_survey_requires_training_session(self):
        serializer = TrainingSurveySerializer(
            data={
                "title": "Khảo sát cuối buổi",
                "form_type": "end_session",
                "notes": "",
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("session", serializer.errors)

    def test_customer_is_derived_from_selected_training_session(self):
        serializer = TrainingSurveySerializer(
            data={
                "title": "Khảo sát cuối buổi",
                "form_type": "end_session",
                "session": self.session.pk,
                "notes": "",
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        survey = serializer.save()
        self.assertEqual(survey.session, self.session)
        self.assertEqual(survey.partner, self.partner)

class OtherWorkScheduleSerializerTests(TestCase):
    def test_other_schedule_keeps_its_selected_type(self):
        serializer = TrainingCustomerMeetingSerializer(
            data={
                "title": "Họp kế hoạch quý",
                "schedule_type": "other",
                "activity_type": "Họp nội bộ",
                "date": "2026-07-29",
                "status": "planned",
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        item = serializer.save()
        self.assertEqual(item.schedule_type, "other")
        self.assertEqual(item.activity_type, "Họp nội bộ")
class TrainingPartnerLocationTests(TestCase):
    def test_partner_keeps_province_and_ward_as_filterable_fields(self):
        serializer = TrainingPartnerSerializer(
            data={
                "name": "Trường thử nghiệm",
                "partner_type": "Khối Giáo dục",
                "partner_subtype": "THCS",
                "province": "Hà Nội",
                "ward": "Việt Hưng",
                "products": ["Tập huấn"],
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        partner = serializer.save()
        self.assertEqual(partner.province, "Hà Nội")
        self.assertEqual(partner.ward, "Việt Hưng")

    def test_training_contents_are_stored_on_each_class(self):
        partner = TrainingPartner.objects.create(name="Khách hàng nhiều lớp")
        serializer = TrainingClassSerializer(
            data={
                "partner": partner.pk,
                "name": "Lớp 1",
                "planned_sessions": 0,
                "training_contents": ["Dashboard", "Dashboard", "AI"],
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        training_class = serializer.save()
        self.assertEqual(training_class.training_contents, ["Dashboard", "AI"])

class TrainingSessionLocationTests(TestCase):
    def test_new_session_has_no_automatic_responsible_staff(self):
        serializer = TrainingSessionSerializer(
            data={
                "title": "Buổi chưa phân công",
                "date": "2026-08-05",
                "status": "planned",
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        session = serializer.save()
        self.assertEqual(session.staff_name, "")

    def test_partial_schedule_sync_does_not_overwrite_responsible_staff(self):
        session = TrainingSession.objects.create(
            title="Buổi 4 · UBP Giảng Võ · Lớp 2",
            staff_name="Ms Liên, Ms Phương",
            status="planned",
        )
        serializer = TrainingSessionSerializer(
            session,
            data={"location": "525 Kim Mã", "notes": "Đồng bộ lịch lớp."},
            partial=True,
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()
        self.assertEqual(updated.staff_name, "Ms Liên, Ms Phương")

    def test_location_is_stored_on_the_calendar_session(self):
        serializer = TrainingSessionSerializer(
            data={
                "title": "Buổi 1",
                "date": "2026-08-05",
                "start_time": "08:00",
                "end_time": "11:00",
                "location": "Hội trường A / https://meet.example.test",
                "status": "planned",
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        session = serializer.save()
        self.assertEqual(session.location, "Hội trường A / https://meet.example.test")
        self.assertEqual(TrainingSessionSerializer(session).data["location"], session.location)

    def test_shared_schedule_keeps_each_session_location(self):
        serializer = TrainingPartnerSerializer(
            data={
                "name": "Khách hàng có lịch theo địa điểm",
                "training_schedule": [
                    {
                        "date": "2026-08-05",
                        "start_time": "08:00",
                        "location": "Phòng 201",
                        "unscheduled": False,
                    },
                    {
                        "date": "2026-08-06",
                        "start_time": "13:30",
                        "location": "https://meet.example.test/buoi-2",
                        "unscheduled": False,
                    },
                ],
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        partner = serializer.save()
        self.assertEqual(partner.training_schedule[0]["location"], "Phòng 201")
        self.assertEqual(partner.training_schedule[1]["location"], "https://meet.example.test/buoi-2")


class TrainingAssessmentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.partner = TrainingPartner.objects.create(name="UBP Giảng Võ")
        self.training_class = TrainingClass.objects.create(partner=self.partner, name="Lớp 2")
        self.assessment = TrainingAssessment.objects.create(
            title="Bài cuối học phần",
            partner=self.partner,
            training_class=self.training_class,
            status="published",
            duration_minutes=20,
            questions=[
                {
                    "id": f"q-{variant}",
                    "variant": variant,
                    "order": 1,
                    "type": "single_choice",
                    "text": "2 + 2 bằng bao nhiêu?",
                    "options": [{"key": "A", "text": "3"}, {"key": "B", "text": "4"}],
                    "correct_answers": ["B"],
                    "points": 1,
                    "required": True,
                }
                for variant in ["Đề 1", "Đề 2", "Đề 3", "Đề 4", "Đề 5"]
            ],
        )

    def test_public_url_uses_partner_and_class_slug(self):
        self.assertEqual(self.assessment.public_slug, "ubp-giang-vo-lop-2")

    def test_only_one_assessment_is_allowed_per_partner_class(self):
        serializer = TrainingAssessmentSerializer(data={
            "title": "Bài bị trùng",
            "training_class": self.training_class.pk,
            "duration_minutes": 15,
            "status": "draft",
            "questions": [],
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn("training_class", serializer.errors)

    def test_variant_assignment_stays_balanced_behind_one_link(self):
        variants = []
        for index in range(13):
            response = self.client.post(
                f"/api/training-assessments/{self.assessment.public_slug}/start",
                {
                    "respondent_name": f"Người học {index}",
                    "email": f"learner{index}@example.test",
                },
                format="json",
            )
            self.assertEqual(response.status_code, 201, response.data)
            variants.append(response.data["variant"])
            self.assertNotIn("correct_answers", response.data["questions"][0])
        counts = Counter(variants)
        self.assertEqual(len(counts), 5)
        self.assertLessEqual(max(counts.values()) - min(counts.values()), 1)

    def test_submit_is_scored_on_server(self):
        start = self.client.post(
            f"/api/training-assessments/{self.assessment.public_slug}/start",
            {"respondent_name": "Nguyễn A", "email": "a@example.test"},
            format="json",
        )
        question_id = start.data["questions"][0]["id"]
        response = self.client.patch(
            f"/api/training-assessment-attempts/{start.data['access_token']}",
            {"answers": {question_id: "B"}, "submit": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "submitted")
        self.assertEqual(float(response.data["score"]), 1)

    def test_xlsx_parser_supports_variant_column(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Nguồn câu hỏi"
        sheet.append(["Mã đề", "STT", "Loại câu", "Câu hỏi", "A", "B", "Đáp án", "Điểm"])
        sheet.append(["Đề 1", 1, "Trắc nghiệm", "Câu một", "Sai", "Đúng", "B", 1])
        sheet.append(["Đề 2", 1, "Trả lời ngắn", "Câu hai", "", "", "Hà Nội", 2])
        buffer = io.BytesIO()
        workbook.save(buffer)
        result = parse_assessment_workbook(buffer.getvalue(), "questions.xlsx")
        self.assertEqual(result["question_count"], 2)
        self.assertEqual([item["name"] for item in result["variants"]], ["Đề 1", "Đề 2"])
        self.assertEqual(result["errors"], [])

    def test_import_generation_balances_usage_and_answer_keys(self):
        source_questions = [
            {
                "id": f"bank-{index}",
                "variant": "Đề 1",
                "order": index,
                "type": "single_choice",
                "text": f"Câu hỏi nguồn {index}",
                "options": [
                    {"key": "A", "text": "Đúng"},
                    {"key": "B", "text": "Sai 1"},
                    {"key": "C", "text": "Sai 2"},
                    {"key": "D", "text": "Sai 3"},
                ],
                "correct_answers": ["A"],
                "points": 1,
                "required": True,
                "category": "Kiến thức",
                "difficulty": "Trung bình",
            }
            for index in range(1, 13)
        ]
        result = generate_variants_from_import(source_questions, 4, 5, seed=20260730)
        self.assertEqual(len(result["variants"]), 4)
        self.assertEqual(result["question_count"], 20)
        source_usage = Counter(item["source_question_id"] for item in result["questions"])
        self.assertLessEqual(max(source_usage.values()) - min(source_usage.values()), 1)
        for variant in result["variants"]:
            questions = [
                item for item in result["questions"]
                if item["variant"] == variant["name"]
            ]
            self.assertEqual(len({item["source_question_id"] for item in questions}), 5)
            answer_counts = Counter(item["correct_answers"][0] for item in questions)
            self.assertLessEqual(max(answer_counts.values()) - min(answer_counts.values()), 1)

    def test_import_generation_removes_duplicate_questions(self):
        source_questions = [
            {
                "id": f"bank-{index}",
                "type": "short_answer",
                "text": "Câu bị trùng" if index < 3 else f"Câu {index}",
                "options": [],
                "correct_answers": ["Đúng"],
                "points": 1,
                "required": True,
            }
            for index in range(1, 6)
        ]
        result = generate_variants_from_import(source_questions, 2, 3, seed=1)
        self.assertEqual(result["source_question_count"], 4)
        self.assertTrue(any("Đã bỏ 1 câu trùng" in warning for warning in result["warnings"]))

    def test_xlsx_parser_uses_sheet_names_for_prepared_variants(self):
        workbook = Workbook()
        first = workbook.active
        first.title = "Đề 1"
        second = workbook.create_sheet("Đề 2")
        for sheet, question in [(first, "Câu của đề một"), (second, "Câu của đề hai")]:
            sheet.append(["STT", "Loại câu", "Câu hỏi", "A", "B", "Đáp án", "Điểm"])
            sheet.append([1, "Trắc nghiệm", question, "Sai", "Đúng", "B", 1])
        buffer = io.BytesIO()
        workbook.save(buffer)
        result = parse_assessment_workbook(buffer.getvalue(), "prepared.xlsx")
        self.assertEqual([item["name"] for item in result["variants"]], ["Đề 1", "Đề 2"])
        self.assertEqual(result["question_count"], 2)
        self.assertEqual(result["errors"], [])
