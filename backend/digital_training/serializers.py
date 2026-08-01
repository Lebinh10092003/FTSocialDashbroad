from django.db.models import Max, Sum
from django.utils import timezone
from rest_framework import serializers

from .assessment_service import variants_for
from .completion_service import schedule_has_ended
from .product_service import sync_partner_product_subscriptions
from .models import (
    TrainingAssessment,
    TrainingAssessmentAttempt,
    TrainingClass,
    TrainingCustomerMeeting,
    TrainingMaterial,
    TrainingPartner,
    TrainingProduct,
    TrainingProductSubscription,
    TrainingSession,
    TrainingSurvey,
)


def product_subscription_status(subscription):
    if subscription.status in {"paused", "cancelled"}:
        return subscription.status
    if subscription.expires_at:
        days = (subscription.expires_at - timezone.localdate()).days
        if days < 0:
            return "expired"
        if days <= 30:
            return "expiring"
    return "active"


class TrainingPartnerSerializer(serializers.ModelSerializer):
    completed_sessions = serializers.SerializerMethodField()

    class Meta:
        model = TrainingPartner
        fields = [
            "id", "name", "address", "contact_person", "contact_position", "phone", "email", "additional_contacts",
            "contract_start", "contract_end", "training_content", "planned_sessions",
            "partner_type", "partner_subtype", "province", "ward", "products", "contract_duration", "contract_duration_unit",
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
                "position": str(item.get("position", "")).strip(),
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
        # Shared sessions are materialised per class by the client workflow.
        # Keeping this hook empty prevents a separate “Tập huấn chung” row.
        return
    def create(self, validated_data):
        partner = super().create(validated_data)
        self._sync_registered_sessions(partner)
        sync_partner_product_subscriptions(partner)
        return partner

    def update(self, instance, validated_data):
        partner = super().update(instance, validated_data)
        self._sync_registered_sessions(partner)
        sync_partner_product_subscriptions(partner)
        return partner


class TrainingProductSerializer(serializers.ModelSerializer):
    customer_count = serializers.SerializerMethodField()
    active_customer_count = serializers.SerializerMethodField()
    expired_customer_count = serializers.SerializerMethodField()
    total_quantity = serializers.SerializerMethodField()

    class Meta:
        model = TrainingProduct
        fields = [
            "id", "name", "code", "description", "active", "display_order",
            "customer_count", "active_customer_count", "expired_customer_count",
            "total_quantity", "created_at", "updated_at",
        ]
        read_only_fields = ["code"]

    def _subscriptions(self, obj):
        return list(obj.subscriptions.exclude(status="cancelled").all())

    def get_customer_count(self, obj):
        return len(self._subscriptions(obj))

    def get_active_customer_count(self, obj):
        return sum(product_subscription_status(item) in {"active", "expiring"} for item in self._subscriptions(obj))

    def get_expired_customer_count(self, obj):
        return sum(product_subscription_status(item) == "expired" for item in self._subscriptions(obj))

    def get_total_quantity(self, obj):
        return obj.subscriptions.exclude(status="cancelled").aggregate(total=Sum("quantity"))["total"] or 0

    def create(self, validated_data):
        if "display_order" not in validated_data:
            validated_data["display_order"] = (TrainingProduct.objects.order_by("-display_order").values_list("display_order", flat=True).first() or 0) + 1
        return super().create(validated_data)


class TrainingProductSubscriptionSerializer(serializers.ModelSerializer):
    partner_name = serializers.CharField(source="partner.name", read_only=True)
    partner_group = serializers.CharField(source="partner.partner_type", read_only=True)
    partner_subtype = serializers.CharField(source="partner.partner_subtype", read_only=True)
    partner_province = serializers.CharField(source="partner.province", read_only=True)
    partner_ward = serializers.CharField(source="partner.ward", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_code = serializers.CharField(source="product.code", read_only=True)
    effective_status = serializers.SerializerMethodField()
    days_remaining = serializers.SerializerMethodField()

    class Meta:
        model = TrainingProductSubscription
        fields = [
            "id", "partner", "partner_name", "partner_group", "partner_subtype",
            "partner_province", "partner_ward", "product", "product_name",
            "product_code", "quantity", "starts_at", "expires_at", "status",
            "effective_status", "days_remaining", "notes", "created_at", "updated_at",
        ]

    def get_effective_status(self, obj):
        return product_subscription_status(obj)

    def get_days_remaining(self, obj):
        return (obj.expires_at - timezone.localdate()).days if obj.expires_at else None

    def validate(self, attrs):
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        expires_at = attrs.get("expires_at", getattr(self.instance, "expires_at", None))
        if starts_at and expires_at and expires_at < starts_at:
            raise serializers.ValidationError({"expires_at": "Han su dung phai sau ngay bat dau."})
        return attrs

    def _sync_partner_product_name(self, subscription):
        values = list(subscription.partner.products or [])
        if subscription.product.name not in values:
            subscription.partner.products = [*values, subscription.product.name]
            subscription.partner.save(update_fields=["products", "updated_at"])

    def create(self, validated_data):
        subscription = super().create(validated_data)
        self._sync_partner_product_name(subscription)
        return subscription

    def update(self, instance, validated_data):
        subscription = super().update(instance, validated_data)
        self._sync_partner_product_name(subscription)
        return subscription

class TrainingClassSerializer(serializers.ModelSerializer):
    partner_name = serializers.CharField(source="partner.name", read_only=True)
    completed_sessions = serializers.SerializerMethodField()

    class Meta:
        model = TrainingClass
        fields = [
            "id", "partner", "partner_name", "name", "members", "planned_sessions", "training_contents",
            "completed_sessions", "notes", "created_at", "updated_at",
        ]

    def get_completed_sessions(self, obj):
        return obj.sessions.filter(status="completed").count()

    def validate_training_contents(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Noi dung tap huan phai la danh sach.")
        return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))


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

    def _mark_past_session_completed(self, validated_data):
        session_date = validated_data.get("session_date", getattr(self.instance, "session_date", None))
        end_time = validated_data.get("end_time", getattr(self.instance, "end_time", None))
        status = validated_data.get("status", getattr(self.instance, "status", "planned"))
        if status == "planned" and schedule_has_ended(session_date, end_time):
            validated_data["status"] = "completed"
        return validated_data
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
        validated_data = self._sync_partner_from_class(self._sync_primary_category(self._mark_past_session_completed(validated_data)))
        training_class = validated_data.get("training_class")
        if training_class and not validated_data.get("session_number"):
            last_number = training_class.sessions.aggregate(Max("session_number"))["session_number__max"] or 0
            validated_data["session_number"] = last_number + 1
        return super().create(validated_data)

    def update(self, instance, validated_data):
        return super().update(instance, self._sync_partner_from_class(self._sync_primary_category(self._mark_past_session_completed(validated_data))))


class TrainingCustomerMeetingSerializer(serializers.ModelSerializer):
    date = serializers.DateField(source="meeting_date")

    class Meta:
        model = TrainingCustomerMeeting
        fields = [
            "id", "title", "schedule_type", "activity_type", "customer_type", "representative", "phone", "email", "date",
            "start_time", "end_time", "location", "content", "status", "staff_name", "notes", "created_at", "updated_at",
        ]

    def validate(self, attrs):
        meeting_date = attrs.get("meeting_date", getattr(self.instance, "meeting_date", None))
        end_time = attrs.get("end_time", getattr(self.instance, "end_time", None))
        status = attrs.get("status", getattr(self.instance, "status", "planned"))
        if status == "planned" and schedule_has_ended(meeting_date, end_time):
            attrs["status"] = "completed"
        return attrs

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


class TrainingAssessmentSerializer(serializers.ModelSerializer):
    session_name = serializers.CharField(source="session.title", read_only=True)
    partner_name = serializers.CharField(source="partner.name", read_only=True)
    class_name = serializers.CharField(source="training_class.name", read_only=True)
    variants = serializers.SerializerMethodField()
    attempts_count = serializers.SerializerMethodField()
    submitted_count = serializers.SerializerMethodField()
    average_score = serializers.SerializerMethodField()
    variant_distribution = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()
    sync_counts = serializers.SerializerMethodField()

    class Meta:
        model = TrainingAssessment
        fields = [
            "id", "title", "session", "session_name", "partner", "partner_name",
            "training_class", "class_name",
            "description", "instructions", "duration_minutes", "opens_at", "closes_at",
            "attempt_limit", "status", "public_slug", "questions", "variants",
            "generation_mode", "generation_config",
            "source_type", "source_name", "question_bank_url", "output_sheet_url",
            "drive_folder_id", "audience_group", "participants", "participant_count",
            "max_people_per_variant", "sync_status", "sync_error", "sync_counts",
            "created_by", "attempts_count", "submitted_count", "average_score",
            "variant_distribution", "created_at", "updated_at",
        ]
        read_only_fields = ["partner", "public_slug", "created_by"]

    def get_variants(self, obj):
        return [
            {
                "name": variant,
                "question_count": sum(
                    1 for item in obj.questions
                    if str(item.get("variant") or "Đề 1") == variant
                ),
            }
            for variant in variants_for(obj)
        ]

    def get_attempts_count(self, obj):
        return obj.attempts.count()

    def get_submitted_count(self, obj):
        return obj.attempts.filter(status__in=["submitted", "timed_out"]).count()

    def get_average_score(self, obj):
        attempts = obj.attempts.filter(status__in=["submitted", "timed_out"], max_score__gt=0)
        percentages = [float(item.score or 0) * 100 / float(item.max_score) for item in attempts]
        return round(sum(percentages) / len(percentages), 1) if percentages else None

    def get_variant_distribution(self, obj):
        return {
            variant: obj.attempts.filter(variant=variant).count()
            for variant in variants_for(obj)
        }

    def get_participant_count(self, obj):
        return len(obj.participants or [])

    def get_sync_counts(self, obj):
        return {
            "pending": obj.attempts.filter(sync_status="pending").count(),
            "synced": obj.attempts.filter(sync_status="synced").count(),
            "error": obj.attempts.filter(sync_status="error").count(),
        }

    def validate_duration_minutes(self, value):
        if value < 1 or value > 480:
            raise serializers.ValidationError("Thời gian làm bài phải từ 1 đến 480 phút.")
        return value

    def validate_attempt_limit(self, value):
        if value < 1 or value > 20:
            raise serializers.ValidationError("Số lượt làm phải từ 1 đến 20.")
        return value

    def validate_max_people_per_variant(self, value):
        if value < 1 or value > 100:
            raise serializers.ValidationError("So nguoi toi da tren mot ma de phai tu 1 den 100.")
        return value

    def validate_participants(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Danh sach nguoi tham gia khong hop le.")
        result = []
        seen = set()
        for index, item in enumerate(value, start=1):
            if not isinstance(item, dict):
                raise serializers.ValidationError(f"Dong nguoi tham gia {index} khong hop le.")
            participant = {
                "code": str(item.get("code") or "").strip(),
                "name": str(item.get("name") or "").strip(),
                "email": str(item.get("email") or "").strip().lower(),
                "phone": str(item.get("phone") or "").strip(),
                "organization": str(item.get("organization") or "").strip(),
                "group": str(item.get("group") or "").strip(),
                "variant": str(item.get("variant") or "").strip(),
            }
            identity = participant["code"].casefold() or participant["email"].casefold() or participant["phone"]
            if not participant["name"] or not identity:
                raise serializers.ValidationError(f"Dong {index} can co ho ten va ma/email/so dien thoai.")
            if identity in seen:
                raise serializers.ValidationError(f"Dong {index} bi trung nguoi tham gia.")
            seen.add(identity)
            result.append(participant)
        return result

    def validate_questions(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Danh sách câu hỏi không hợp lệ.")
        for index, question in enumerate(value, start=1):
            if not isinstance(question, dict) or not str(question.get("text") or "").strip():
                raise serializers.ValidationError(f"Câu {index} chưa có nội dung.")
            if question.get("type") not in {
                "single_choice", "multiple_choice", "short_answer", "matching",
                "ordering", "practical_submission", "file_upload",
            }:
                raise serializers.ValidationError(f"Câu {index} có loại câu chưa được hỗ trợ.")
        return value

    def validate(self, attrs):
        session = attrs.get("session") or getattr(self.instance, "session", None)
        training_class = attrs.get("training_class") or getattr(self.instance, "training_class", None)
        partner = (
            training_class.partner if training_class else
            session.partner_ref if session and session.partner_ref else
            session.training_class.partner if session and session.training_class else
            getattr(self.instance, "partner", None)
        )
        if not partner:
            raise serializers.ValidationError({"training_class": "Vui lòng chọn đơn vị hoặc phân lớp tập huấn."})
        if session and training_class and session.training_class_id and session.training_class_id != training_class.id:
            raise serializers.ValidationError({"session": "Buổi tập huấn không thuộc phân lớp đã chọn."})
        attrs["partner"] = partner
        status_value = attrs.get("status", getattr(self.instance, "status", "draft"))
        questions = attrs.get("questions", getattr(self.instance, "questions", []))
        participants = attrs.get("participants", getattr(self.instance, "participants", []))
        variant_names = sorted({str(item.get("variant") or "") for item in questions if str(item.get("variant") or "")}, key=str.casefold)
        if participants and variant_names:
            attrs["participants"] = [
                {**item, "variant": item.get("variant") if item.get("variant") in variant_names else variant_names[index % len(variant_names)]}
                for index, item in enumerate(participants)
            ]
        if status_value == "published" and not questions:
            raise serializers.ValidationError({"questions": "Cần nhập câu hỏi trước khi phát hành."})
        opens_at = attrs.get("opens_at", getattr(self.instance, "opens_at", None))
        closes_at = attrs.get("closes_at", getattr(self.instance, "closes_at", None))
        if opens_at and closes_at and closes_at <= opens_at:
            raise serializers.ValidationError({"closes_at": "Thời gian đóng phải sau thời gian mở."})
        return attrs

    def update(self, instance, validated_data):
        next_class = validated_data.get("training_class", instance.training_class)
        next_partner = validated_data.get("partner", instance.partner)
        if instance.training_class_id != getattr(next_class, "id", None) or instance.partner_id != getattr(next_partner, "id", None):
            instance.public_slug = ""
        return super().update(instance, validated_data)


class TrainingAssessmentAttemptSerializer(serializers.ModelSerializer):
    uploads = serializers.SerializerMethodField()

    class Meta:
        model = TrainingAssessmentAttempt
        fields = [
            "id", "respondent_name", "email", "phone", "organization",
            "participant_code", "variant", "answers", "progress", "score",
            "max_score", "auto_graded_points", "practical_score",
            "manual_grading_required", "status", "sync_status", "sync_error",
            "synced_at", "purge_after", "started_at", "expires_at",
            "submitted_at", "updated_at", "uploads",
        ]

    def get_uploads(self, obj):
        request = self.context.get("request")
        result = []
        for upload in obj.uploads.all():
            url = upload.drive_url or (upload.file.url if upload.file else "")
            result.append({
                "id": upload.id,
                "file_id": upload.drive_file_id,
                "storage": upload.sync_status,
                "question_id": upload.question_id,
                "name": upload.original_name,
                "url": request.build_absolute_uri(url) if request and url.startswith("/") else url,
            })
        return result
