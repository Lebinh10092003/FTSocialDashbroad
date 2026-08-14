from django.db import migrations, models
from django.utils.text import slugify


def shorten_assessment_slugs(apps, schema_editor):
    TrainingAssessment = apps.get_model("digital_training", "TrainingAssessment")
    used = set(TrainingAssessment.objects.values_list("public_slug", flat=True))
    for assessment in TrainingAssessment.objects.select_related("partner", "training_class").all():
        label = (
            assessment.partner.name if assessment.partner_id else (
                assessment.training_class.name if assessment.training_class_id else ""
            )
        )
        candidate = slugify(
            f"{str(label).replace('Đ', 'D').replace('đ', 'd')} Bai kiem tra cuoi khoa tap huan"
        ) or assessment.public_slug
        base = candidate
        suffix = 2
        used.discard(assessment.public_slug)
        while candidate in used:
            candidate = f"{base}-{suffix}"
            suffix += 1
        used.add(candidate)
        legacy_slugs = list(assessment.legacy_public_slugs or [])
        if assessment.public_slug != candidate and assessment.public_slug not in legacy_slugs:
            legacy_slugs.append(assessment.public_slug)
        assessment.public_slug = candidate
        assessment.legacy_public_slugs = legacy_slugs
        assessment.save(update_fields=["public_slug", "legacy_public_slugs"])


class Migration(migrations.Migration):
    dependencies = [
        ("digital_training", "0036_trainingassessmentattempt_position"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingassessment",
            name="legacy_public_slugs",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(shorten_assessment_slugs, migrations.RunPython.noop),
    ]
