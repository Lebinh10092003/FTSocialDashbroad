"""Conservative cleanup limited to local assessment answer uploads."""
import json
from pathlib import Path
from urllib.parse import unquote

from django.conf import settings
from .models import TrainingAssessment, TrainingAssessmentAttempt, TrainingAssessmentUpload

PREFIX = "digital-training/assessment-answers/"

def referenced_names():
    names = set(TrainingAssessmentUpload.objects.exclude(file="").values_list("file", flat=True))
    # Preserve files linked directly in any surviving question or answer too.
    documents = list(TrainingAssessmentAttempt.objects.values_list("answers", flat=True))
    documents += list(TrainingAssessment.objects.values_list("questions", flat=True))
    text = unquote(json.dumps(documents, ensure_ascii=False))
    return names, text

def safe_answer_path(name):
    if not name.startswith(PREFIX):
        return None
    media = Path(settings.MEDIA_ROOT).resolve()
    root = media / PREFIX
    path = media / name
    if not root.resolve().is_relative_to(media) or path.is_symlink():
        return None
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        return None
    return resolved

def delete_unreferenced_answer(name):
    path = safe_answer_path(name)
    if not path or not path.is_file():
        return False
    names, text = referenced_names()
    if name in names or name in text:
        return False
    path.unlink()
    return True
