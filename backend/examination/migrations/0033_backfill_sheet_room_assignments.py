import re

from django.db import migrations


def room_details(location, mode):
    raw_location = str(location or '').strip()
    if not raw_location:
        return None
    lines = [line.strip() for line in raw_location.splitlines() if line.strip()]
    label = next((line.rstrip(':').strip() for line in lines if not re.match(r'^https?://', line, re.I)), '')
    if not label:
        return None
    link_match = re.search(r'https?://[^\s<>]+', raw_location, re.I)
    link = link_match.group(0) if link_match else ''
    mode_value = str(mode or '').casefold()
    is_online = bool(link) or 'online' in mode_value or 'trực tuyến' in mode_value
    return {
        'label': label[:500],
        'room_number': label[:100],
        'link': link,
        'mode': 'ONLINE' if is_online else 'IN_PERSON',
        'location': '' if is_online else raw_location[:1000],
    }


def forwards(apps, schema_editor):
    """Link historical Sheet room cells to reusable ExamRoom records."""
    ExamRoom = apps.get_model('examination', 'ExamRoom')
    RoundResult = apps.get_model('examination', 'RoundResult')

    results = RoundResult.objects.filter(exam_room__isnull=True).exclude(location='').select_related('participation__session')
    for result in results.iterator():
        if not result.round_id:
            continue
        details = room_details(result.location, result.mode)
        if not details:
            continue
        session = result.participation.session
        room, _ = ExamRoom.objects.get_or_create(
            session=session,
            round_id=result.round_id,
            occurrence_id=result.occurrence_id or '',
            room_number=details['room_number'],
            defaults={
                'round_name': result.round_name,
                'common_name': 'Phòng từ Google Sheet',
                'label': details['label'],
                'mode': details['mode'],
                'location': details['location'],
                'link': details['link'],
                'exam_link': '',
                'allocation_strategy': 'BALANCED',
                'position': ExamRoom.objects.filter(
                    session=session,
                    round_id=result.round_id,
                    occurrence_id=result.occurrence_id or '',
                ).count(),
                'created_by': 'Google Sheet import',
            },
        )
        result.exam_room_id = room.id
        result.room_name = room.label
        result.save(update_fields=['exam_room', 'room_name'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0032_correct_aysbc_batch_membership')]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
