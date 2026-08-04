from django.db import migrations


SCHOOLCONNECT_EXAM_LINK = 'https://www.schoolconnectonline.com/App/Student/Login.aspx?ReturnUrl=/app/org/online'


def separate_room_links_from_exam_links(apps, schema_editor):
    RoundResult = apps.get_model('examination', 'RoundResult')
    ExamSession = apps.get_model('examination', 'ExamSession')

    for result in RoundResult.objects.select_related('exam_room').filter(exam_room__mode='ONLINE').iterator():
        room = result.exam_room
        if room and room.link:
            location = f'{room.label}:\n{room.link}'
            if result.location != location:
                RoundResult.objects.filter(pk=result.pk).update(location=location)

    sco_session_ids = ExamSession.objects.filter(organizer__iexact='SCO').values_list('id', flat=True)
    RoundResult.objects.filter(participation__session_id__in=sco_session_ids).exclude(link=SCHOOLCONNECT_EXAM_LINK).update(link=SCHOOLCONNECT_EXAM_LINK)


class Migration(migrations.Migration):
    dependencies = [('examination', '0028_normalize_round_eligibility')]

    operations = [
        migrations.RunPython(separate_room_links_from_exam_links, migrations.RunPython.noop),
    ]