from rest_framework import serializers
from .models import TrainingSession

class TrainingSessionSerializer(serializers.ModelSerializer):
    date = serializers.DateField(source="session_date")

    class Meta:
        model = TrainingSession
        fields = ["id", "title", "date", "partner", "category", "attendees", "notes"]
