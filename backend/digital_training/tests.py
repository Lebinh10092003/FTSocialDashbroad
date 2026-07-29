from django.test import TestCase

from .models import TrainingClass, TrainingPartner, TrainingSession, TrainingSurvey
from .serializers import TrainingClassSerializer, TrainingCustomerMeetingSerializer, TrainingPartnerSerializer, TrainingSurveySerializer


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
