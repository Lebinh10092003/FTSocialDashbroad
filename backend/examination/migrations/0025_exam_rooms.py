import django.db.models.deletion
import uuid
from django.db import migrations, models


def backfill_round_ids(apps, schema_editor):
    ExamSession = apps.get_model('examination', 'ExamSession')
    CandidateParticipation = apps.get_model('examination', 'CandidateParticipation')
    RoundResult = apps.get_model('examination', 'RoundResult')

    for session in ExamSession.objects.all().iterator():
        configured = [item for item in (session.rounds or []) if isinstance(item, dict)]
        if not configured:
            continue
        by_name = {
            str(item.get('name') or '').strip().casefold(): str(item.get('id') or '')
            for item in configured
            if item.get('name') and item.get('id')
        }
        for participation in CandidateParticipation.objects.filter(session_id=session.id).iterator():
            results = list(RoundResult.objects.filter(participation_id=participation.id).order_by('round_name', 'id'))
            for index, result in enumerate(results):
                round_id = by_name.get(str(result.round_name or '').strip().casefold(), '')
                if not round_id and index < len(configured):
                    round_id = str(configured[index].get('id') or '')
                if round_id:
                    RoundResult.objects.filter(id=result.id).update(round_id=round_id)


def clear_round_ids(apps, schema_editor):
    apps.get_model('examination', 'RoundResult').objects.update(round_id='')


class Migration(migrations.Migration):

    dependencies = [
        ('examination', '0024_alter_aiproviderconfig_options_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='ExamRoom',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('round_id', models.CharField(max_length=255)),
                ('round_name', models.CharField(max_length=255)),
                ('common_name', models.CharField(max_length=255)),
                ('room_number', models.CharField(max_length=100)),
                ('label', models.CharField(max_length=500)),
                ('mode', models.CharField(choices=[('IN_PERSON', 'Trực tiếp'), ('ONLINE', 'Trực tuyến')], max_length=20)),
                ('location', models.CharField(blank=True, default='', max_length=1000)),
                ('link', models.CharField(blank=True, default='', max_length=2000)),
                ('allocation_strategy', models.CharField(choices=[('BALANCED', 'Chia đều'), ('CAPACITY', 'Theo sức chứa tối đa')], default='BALANCED', max_length=20)),
                ('capacity', models.PositiveIntegerField(blank=True, null=True)),
                ('position', models.PositiveIntegerField(default=0)),
                ('created_by', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='exam_rooms', to='examination.examsession')),
            ],
            options={'ordering': ['position', 'room_number']},
        ),
        migrations.AddConstraint(
            model_name='examroom',
            constraint=models.UniqueConstraint(fields=('session', 'round_id', 'room_number'), name='unique_exam_room_number_per_round'),
        ),
        migrations.AddField(
            model_name='roundresult',
            name='exam_room',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assignments', to='examination.examroom'),
        ),
        migrations.AddField(
            model_name='roundresult',
            name='round_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='roundresult',
            name='room_name',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
        migrations.RunPython(backfill_round_ids, clear_round_ids),
    ]
