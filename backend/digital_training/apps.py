from django.apps import AppConfig

class DigitalTrainingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "digital_training"

    def ready(self):
        from . import signals  # noqa: F401
