from django.db import migrations, models


def backfill_room_exam_links(apps, schema_editor):
    ExamRoom = apps.get_model('examination', 'ExamRoom')
    RoundResult = apps.get_model('examination', 'RoundResult')
    for room in ExamRoom.objects.all().iterator():
        exam_link = RoundResult.objects.filter(exam_room_id=room.id).exclude(link='').values_list('link', flat=True).first()
        if exam_link:
            ExamRoom.objects.filter(pk=room.pk).update(exam_link=exam_link)


class Migration(migrations.Migration):
    dependencies = [('examination', '0029_separate_room_links_from_exam_links')]

    operations = [
        migrations.AddField(
            model_name='examroom',
            name='exam_link',
            field=models.CharField(blank=True, default='', max_length=2000),
        ),
        migrations.RunPython(backfill_room_exam_links, migrations.RunPython.noop),
    ]