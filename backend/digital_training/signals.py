import logging
from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver
from .models import TrainingAssessmentUpload
from .assessment_storage import delete_unreferenced_answer

logger = logging.getLogger(__name__)

@receiver(post_delete, sender=TrainingAssessmentUpload)
def cleanup_deleted_assessment_upload(sender, instance, **kwargs):
    if not instance.file:
        return
    name = instance.file.name
    def cleanup():
        try:
            delete_unreferenced_answer(name)
        except Exception:
            logger.exception("Could not remove deleted assessment upload")
    transaction.on_commit(cleanup)
