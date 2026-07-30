from django.db import migrations


def forwards(apps, schema_editor):
    BlueprintSlot = apps.get_model('examination', 'BlueprintSlot')
    slots = BlueprintSlot.objects.filter(version__blueprint__competition_id='fimo', version__blueprint__grade_or_category__icontains='7')
    for slot in slots.iterator():
        position = slot.position
        label = 'Rất dễ' if position <= 3 else 'Dễ' if position <= 8 else 'Trung bình' if position <= 18 else 'Khá' if position <= 28 else 'Khó'
        metadata = dict(slot.metadata or {})
        if metadata.get('difficultyLabel') == label:
            continue
        metadata['difficultyLabel'] = label
        slot.metadata = metadata
        slot.save(update_fields=['metadata'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0021_exampaper_approved_at_exampaper_approved_by_and_more')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
