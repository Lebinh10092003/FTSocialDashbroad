from django.db import migrations


def seed_fimo_grade_7(apps, schema_editor):
    Competition = apps.get_model('examination', 'Competition')
    Blueprint = apps.get_model('examination', 'Blueprint')
    BlueprintVersion = apps.get_model('examination', 'BlueprintVersion')
    BlueprintSlot = apps.get_model('examination', 'BlueprintSlot')
    competition = Competition.objects.filter(code='FIMO').first()
    if not competition:
        competition = Competition.objects.create(id='competition-fimo-blueprint', code='FIMO', name='Fermat International Mathematics Olympiad', parent='FermatTech', organizer='FermatTech', sort_key='FIMO')
    blueprint, created = Blueprint.objects.get_or_create(
        competition_id=competition.id, name='FIMO – Khối 7 – Ma trận mẫu 32 câu',
        defaults={
            'round_name': 'Vòng quốc gia', 'subject': 'Toán', 'grade_or_category': 'Khối 7', 'language': 'Tiếng Việt',
            'description': 'Ma trận mẫu FIMO khối 7 gồm 30 câu trắc nghiệm 5 phương án và 2 câu điền đáp số.',
            'created_by': 'System', 'updated_by': 'System',
            'metadata_schema': {'type': 'object', 'properties': {
                'CTX': {'type': 'string'}, 'VA': {'type': 'string'}, 'CL': {'type': 'string'}, 'CaL': {'type': 'string'},
                'expectedMisconception': {'type': 'string'}}, 'additionalProperties': True},
        })
    if not created or blueprint.versions.exists():
        return
    version = BlueprintVersion.objects.create(blueprint=blueprint, version_number=1, status='LOCKED', note='Dữ liệu mẫu FIMO lớp 7', created_by='System', locked_by='System')
    topics = ['Số học', 'Đại số', 'Hình học', 'Tư duy logic']
    levels = ['EASY'] * 6 + ['MEDIUM'] * 17 + ['HARD'] * 6 + ['VERY_HARD'] * 3
    for position, difficulty in enumerate(levels, 1):
        numeric = position > 30
        BlueprintSlot.objects.create(version=version, position=position, question_type='numeric_input' if numeric else 'single_choice', option_count=0 if numeric else 5, score=1, difficulty=difficulty, topic=topics[(position - 1) % len(topics)], knowledge_source='Chương trình Toán lớp 7', knowledge_requirements='Kiến thức Toán lớp 7 theo syllabus FIMO.', prohibited_knowledge='Không sử dụng kiến thức vượt quá phạm vi lớp 7.', assessment_intent='Đánh giá khả năng vận dụng và lập luận.', estimated_seconds=90, metadata={'CTX': 'FIMO G7', 'expectedMisconception': ''})


def unseed_fimo_grade_7(apps, schema_editor):
    Blueprint = apps.get_model('examination', 'Blueprint')
    Blueprint.objects.filter(name='FIMO – Khối 7 – Ma trận mẫu 32 câu').delete()


class Migration(migrations.Migration):
    dependencies = [('examination', '0014_blueprintslot_examquestion_question_type_and_more')]
    operations = [migrations.RunPython(seed_fimo_grade_7, unseed_fimo_grade_7)]