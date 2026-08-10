from django.db import migrations


JUNE_CODES = {
    'FT-00001', 'FT-00002', 'FT-00004', 'FT-00005', 'FT-00006',
    'FT-00008', 'FT-00011', 'FT-00013', 'FT-00014', 'FT-00015',
}
JUNE_OCCURRENCE_ID = 'aysbc-national-final-2026-06'
JULY_OCCURRENCE_ID = 'aysbc-national-final-2026-07'


def forwards(apps, schema_editor):
    RoundResult = apps.get_model('examination', 'RoundResult')
    for result in RoundResult.objects.filter(
        participation__session_id='aysbc',
        round_id='aysbc-national-final',
    ).select_related('participation__candidate').iterator():
        candidate_code = str(result.participation.candidate.code or '').strip()
        # FT-00014 legitimately has one attempt in each batch.  Its July row
        # is already identifiable by its date; the remaining listed records
        # belong to the June source session.
        is_june = candidate_code in JUNE_CODES and str(result.exam_date or '').strip() != '2026-07-26'
        result.occurrence_id = JUNE_OCCURRENCE_ID if is_june else JULY_OCCURRENCE_ID
        result.exam_date = '2026-06-21' if is_june else '2026-07-26'
        result.save(update_fields=['occurrence_id', 'exam_date'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0031_round_organization_batches_and_merge_aysbc')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
