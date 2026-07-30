from django.db import migrations


def forwards(apps, schema_editor):
    Blueprint = apps.get_model('examination', 'Blueprint')
    BlueprintSlot = apps.get_model('examination', 'BlueprintSlot')
    BlueprintVersion = apps.get_model('examination', 'BlueprintVersion')
    Candidate = apps.get_model('examination', 'Candidate')
    CandidateParticipation = apps.get_model('examination', 'CandidateParticipation')
    ExamPaper = apps.get_model('examination', 'ExamPaper')
    ExamSession = apps.get_model('examination', 'ExamSession')
    ExaminationSheet = apps.get_model('examination', 'ExaminationSheet')
    RoundResult = apps.get_model('examination', 'RoundResult')

    canonical = ExamSession.objects.filter(pk='fimo-2026-2027').first()
    legacy = ExamSession.objects.filter(pk='fimo').first()
    if not canonical or not legacy:
        return

    Blueprint.objects.filter(session_id=legacy.id).update(session_id=canonical.id)
    ExamPaper.objects.filter(session_id=legacy.id).update(session_id=canonical.id)
    ExaminationSheet.objects.filter(session_id=legacy.id).update(session_id=canonical.id)

    for participation in CandidateParticipation.objects.filter(session_id=legacy.id):
        target = CandidateParticipation.objects.filter(candidate_id=participation.candidate_id, session_id=canonical.id).first()
        if not target:
            participation.session_id = canonical.id
            participation.save(update_fields=['session'])
            continue
        existing_rounds = set(RoundResult.objects.filter(participation_id=target.id).values_list('round_name', flat=True))
        RoundResult.objects.filter(participation_id=participation.id).exclude(round_name__in=existing_rounds).update(participation_id=target.id)
        participation.delete()

    for candidate in Candidate.objects.all().iterator():
        session_ids = list(candidate.session_ids or [])
        if legacy.id in session_ids:
            candidate.session_ids = [canonical.id if item == legacy.id else item for item in session_ids]
            candidate.session_ids = list(dict.fromkeys(candidate.session_ids))
        history = list(candidate.exam_history or [])
        changed = False
        for item in history:
            if isinstance(item, dict) and item.get('sessionId') == legacy.id:
                item['sessionId'] = canonical.id
                changed = True
        if legacy.id in session_ids or changed:
            candidate.exam_history = history
            candidate.save(update_fields=['session_ids', 'exam_history'])

    legacy.delete()

    blueprint = Blueprint.objects.filter(competition_id='fimo', grade_or_category__icontains='7').first()
    if not blueprint:
        return
    blueprint.session_id = canonical.id
    blueprint.duration_minutes = 90
    blueprint.save(update_fields=['session', 'duration_minutes'])
    version = BlueprintVersion.objects.filter(blueprint_id=blueprint.id, status='LOCKED').first()
    if not version or BlueprintSlot.objects.filter(version_id=version.id).count() != 32:
        return
    for slot in BlueprintSlot.objects.filter(version_id=version.id).order_by('position'):
        position = slot.position
        slot.difficulty = 'EASY' if position <= 8 else 'MEDIUM' if position <= 18 else 'HARD' if position <= 28 else 'VERY_HARD'
        slot.question_type = 'numeric_input' if position > 30 else 'single_choice'
        slot.option_count = 0 if position > 30 else 5
        slot.score = 5 if position > 30 else 3
        slot.estimated_seconds = 300 if position > 30 else 150
        slot.save(update_fields=['difficulty', 'question_type', 'option_count', 'score', 'estimated_seconds'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0019_blueprint_duration_minutes')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
