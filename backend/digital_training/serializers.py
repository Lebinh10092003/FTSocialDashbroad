from rest_framework import serializers

from .models import TrainingMaterial, TrainingPartner, TrainingSession, TrainingSurvey


class TrainingPartnerSerializer(serializers.ModelSerializer):
    completed_sessions = serializers.SerializerMethodField()

    class Meta:
        model = TrainingPartner
        fields = [
            "id", "name", "address", "contact_person", "phone", "email",
            "contract_start", "contract_end", "training_content", "planned_sessions",
            "completed_sessions", "notes", "created_at", "updated_at",
        ]

    def get_completed_sessions(self, obj):
        return obj.sessions.filter(status="completed").count()


class TrainingSessionSerializer(serializers.ModelSerializer):
    date = serializers.DateField(source="session_date")
    partner_id = serializers.PrimaryKeyRelatedField(source="partner_ref", queryset=TrainingPartner.objects.all(), required=False, allow_null=True)
    partner_name = serializers.SerializerMethodField()
    has_materials = serializers.SerializerMethodField()

    class Meta:
        model = TrainingSession
        fields = [
            "id", "title", "date", "start_time", "end_time", "partner", "partner_id", "partner_name",
            "category", "attendees", "location", "status", "notes", "has_materials", "created_at", "updated_at",
        ]

    def get_partner_name(self, obj):
        return obj.partner_ref.name if obj.partner_ref else obj.partner

    def get_has_materials(self, obj):
        return obj.materials.exists()

    def create(self, validated_data):
        partner = validated_data.get("partner_ref")
        if partner:
            validated_data["partner"] = partner.name
        return super().create(validated_data)

    def update(self, instance, validated_data):
        partner = validated_data.get("partner_ref")
        if partner:
            validated_data["partner"] = partner.name
        return super().update(instance, validated_data)


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