from django.db.models import Max
from rest_framework import serializers

from .models import TrainingClass, TrainingCustomerMeeting, TrainingMaterial, TrainingPartner, TrainingSession, TrainingSurvey


class TrainingPartnerSerializer(serializers.ModelSerializer):
    completed_sessions = serializers.SerializerMethodField()

    class Meta:
        model = TrainingPartner
        fields = [
            "id", "name", "address", "contact_person", "phone", "email", "additional_contacts",
            "contract_start", "contract_end", "training_content", "planned_sessions",
            "partner_type", "products", "contract_duration", "contract_duration_unit",
            "contract_signed_date", "contract_status", "budget", "ai_account_count", "training_contents",
            "training_schedule", "training_location", "training_staff", "completed_sessions", "notes", "created_at", "updated_at",
        ]

    def get_completed_sessions(self, obj):
        return obj.sessions.filter(status="completed").count()

    def validate_additional_contacts(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Danh sach dau moi phai la danh sach.")
        cleaned = []
        for item in value:
            if not isinstance(item, dict):
                continue
            contact = {
                "contact_person": str(item.get("contact_person", "")).strip(),
                "phone": str(item.get("phone", "")).strip(),
                "email": str(item.get("email", "")).strip(),
            }
            if any(contact.values()):
                cleaned.append(contact)
        return cleaned
    def validate_products(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("San pham dang ky phai la danh sach.")
        return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))

    def validate_training_contents(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Noi dung tap huan phai la danh sach.")
        return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))

    def _sync_registered_sessions(self, partner):
        prefix = "Tạo từ đăng ký tập huấn"
        partner.sessions.filter(training_class__isnull=True, notes__startswith=prefix).delete()
        if "Tập huấn" not in (partner.products or []):
            return
        contents = partner.training_contents or []
        for number, item in enumerate(partner.training_schedule or [], start=1):
            if not isinstance(item, dict):
                continue
            unscheduled = bool(item.get("unscheduled")) or not item.get("date")
            TrainingSession.objects.create(
                title=f"Buổi chung {number} · {partner.name}",
                session_number=number,
                session_date=None if unscheduled else item.get("date"),
                start_time=None if unscheduled else (item.get("start_time") or None),
                partner=partner.name,
                partner_ref=partner,
                category=" · ".join(contents),
                contents=contents,
                location=partner.training_location,
                staff_name=partner.training_staff,
                status="unscheduled" if unscheduled else "planned",
                notes=f"{prefix}: buổi chung {number}.",
            )

    def create(self, validated_data):
        partner = super().create(validated_data)
        self._sync_registered_sessions(partner)
        return partner

    def update(self, instance, validated_data):
        partner = super().update(instance, validated_data)
        self._sync_registered_sessions(partner)
        return partner

class TrainingClassSerializer(serializers.ModelSerializer):
    partner_name = serializers.CharField(source="partner.name", read_only=True)
    completed_sessions = serializers.SerializerMethodField()

    class Meta:
        model = TrainingClass
        fields = [
            "id", "partner", "partner_name", "name", "members", "planned_sessions",
            "completed_sessions", "notes", "created_at", "updated_at",
        ]

    def get_completed_sessions(self, obj):
        return obj.sessions.filter(status="completed").count()


class TrainingSessionSerializer(serializers.ModelSerializer):
    date = serializers.DateField(source="session_date", required=False, allow_null=True)
    partner_id = serializers.PrimaryKeyRelatedField(source="partner_ref", queryset=TrainingPartner.objects.all(), required=False, allow_null=True)
    partner_name = serializers.SerializerMethodField()
    class_group_id = serializers.PrimaryKeyRelatedField(source="training_class", queryset=TrainingClass.objects.all(), required=False, allow_null=True)
    class_group_name = serializers.CharField(source="training_class.name", read_only=True)
    has_materials = serializers.SerializerMethodField()

    class Meta:
        model = TrainingSession
        fields = [
            "id", "title", "session_number", "date", "start_time", "end_time", "partner", "partner_id", "partner_name",
            "class_group_id", "class_group_name", "category", "contents", "attendees", "location",
            "status", "notes", "staff_name", "has_materials", "created_at", "updated_at",
        ]

    def get_partner_name(self, obj):
        return obj.partner_ref.name if obj.partner_ref else obj.partner

    def get_has_materials(self, obj):
        return obj.materials.exists()

    def validate_contents(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Noi dung tap huan phai la danh sach.")
        return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))

    def _sync_primary_category(self, validated_data):
        contents = validated_data.get("contents")
        if contents:
            validated_data["category"] = " · ".join(contents)
        elif validated_data.get("category"):
            validated_data["contents"] = [validated_data["category"]]
        return validated_data

    def _sync_partner_from_class(self, validated_data):
        training_class = validated_data.get("training_class")
        if training_class:
            validated_data["partner_ref"] = training_class.partner
            validated_data["partner"] = training_class.partner.name
        elif validated_data.get("partner_ref"):
            validated_data["partner"] = validated_data["partner_ref"].name
        return validated_data

    def create(self, validated_data):
        validated_data = self._sync_partner_from_class(self._sync_primary_category(validated_data))
        training_class = validated_data.get("training_class")
        if training_class and not validated_data.get("session_number"):
            last_number = training_class.sessions.aggregate(Max("session_number"))["session_number__max"] or 0
            validated_data["session_number"] = last_number + 1
        return super().create(validated_data)

    def update(self, instance, validated_data):
        return super().update(instance, self._sync_partner_from_class(self._sync_primary_category(validated_data)))


class TrainingCustomerMeetingSerializer(serializers.ModelSerializer):
    date = serializers.DateField(source="meeting_date")

    class Meta:
        model = TrainingCustomerMeeting
        fields = [
            "id", "title", "schedule_type", "activity_type", "customer_type", "representative", "phone", "email", "date",
            "start_time", "end_time", "location", "content", "status", "staff_name", "notes", "created_at", "updated_at",
        ]

class TrainingMaterialSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    session_name = serializers.CharField(source="session.title", read_only=True)
    partner_name = serializers.CharField(source="partner.name", read_only=True)

    class Meta:
        model = TrainingMaterial
        fields = [
            "id", "title", "file", "file_url", "external_url", "file_name", "file_type",
            "session", "session_name", "partner", "partner_name", "notes", "created_at", "updated_at",
        ]
        extra_kwargs = {"file": {"required": False, "allow_null": True}}

    def get_file_url(self, obj):
        if not obj.file:
            return ""
        request = self.context.get("request")
        url = obj.file.url
        return request.build_absolute_uri(url) if request else url

    def create(self, validated_data):
        uploaded = validated_data.get("file")
        if uploaded:
            validated_data.setdefault("file_name", uploaded.name)
            validated_data.setdefault("file_type", uploaded.content_type or "")
        return super().create(validated_data)


class TrainingSurveySerializer(serializers.ModelSerializer):
    session_name = serializers.CharField(source="session.title", read_only=True)
    partner_name = serializers.CharField(source="partner.name", read_only=True)

    class Meta:
        model = TrainingSurvey
        fields = ["id", "title", "form_type", "session", "session_name", "partner", "partner_name", "notes", "created_at", "updated_at"]
        read_only_fields = ["partner"]

    def validate(self, attrs):
        session = attrs.get("session") or getattr(self.instance, "session", None)
        if session is None:
            raise serializers.ValidationError({"session": "Vui lòng chọn lịch tập huấn."})
        attrs["partner"] = session.partner_ref or (
            session.training_class.partner if session.training_class else None
        )
        return attrs
