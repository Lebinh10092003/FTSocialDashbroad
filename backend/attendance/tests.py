from datetime import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile

from .models import AttendanceRecord
from .views import _worked_minutes


class AttendanceApiTests(TestCase):
    def setUp(self):
        django_user = get_user_model().objects.create_user(
            username="attendance@example.com",
            email="attendance@example.com",
            password="StrongPassword9921",
        )
        self.profile = UserProfile.objects.create(
            email=django_user.email,
            name="Nhân viên chấm công",
            role="EMPLOYEE",
            access_modules=[],
        )
        self.token = Token.objects.create(user=django_user).key

    def request(self, method, path, payload=None):
        return getattr(self.client, method)(
            path,
            payload or {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_employee_can_clock_in_and_out_and_data_is_persisted(self):
        clock_in = self.request("post", "/api/attendance/clock", {"action": "IN", "shiftCode": "OFFICE", "note": "Làm tại văn phòng"})
        self.assertEqual(clock_in.status_code, 201)
        self.assertEqual(clock_in.json()["record"]["shiftCode"], "OFFICE")
        self.assertEqual(AttendanceRecord.objects.count(), 1)

        duplicate = self.request("post", "/api/attendance/clock", {"action": "IN", "shiftCode": "MORNING"})
        self.assertEqual(duplicate.status_code, 400)

        clock_out = self.request("post", "/api/attendance/clock", {"action": "OUT"})
        self.assertEqual(clock_out.status_code, 200)
        self.assertIsNotNone(clock_out.json()["record"]["clockOut"])
        self.assertIsNotNone(AttendanceRecord.objects.get().clock_out)

        listing = self.request("get", f"/api/attendance/records?month={timezone.localdate():%Y-%m}")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.json()["records"]), 1)
        self.assertIsNone(listing.json()["current"])

    def test_guest_cannot_read_or_write_attendance(self):
        self.assertEqual(self.client.get("/api/attendance/records").status_code, 401)
        self.assertEqual(self.client.post("/api/attendance/clock", {"action": "IN"}, content_type="application/json").status_code, 401)

    def test_employee_only_sees_their_own_records(self):
        other = UserProfile.objects.create(email="other@example.com", name="Other", role="EMPLOYEE")
        AttendanceRecord.objects.create(
            employee=other,
            work_date=timezone.localdate(),
            shift_code="MORNING",
            shift_name="Ca sáng",
            scheduled_start="08:00",
            scheduled_end="12:00",
            expected_minutes=240,
            clock_in=timezone.now(),
        )
        listing = self.request("get", f"/api/attendance/records?month={timezone.localdate():%Y-%m}&scope=team")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["records"], [])
        self.assertEqual(listing.json()["scope"], "mine")

    def test_office_duration_excludes_lunch_break(self):
        local_tz = timezone.get_current_timezone()
        item = AttendanceRecord(
            employee=self.profile,
            work_date=timezone.localdate(),
            shift_code="OFFICE",
            shift_name="Ca hành chính",
            scheduled_start="08:00",
            scheduled_end="17:30",
            expected_minutes=480,
            clock_in=timezone.make_aware(datetime.combine(timezone.localdate(), datetime.strptime("08:00", "%H:%M").time()), local_tz),
            clock_out=timezone.make_aware(datetime.combine(timezone.localdate(), datetime.strptime("17:30", "%H:%M").time()), local_tz),
        )
        self.assertEqual(_worked_minutes(item), 480)
