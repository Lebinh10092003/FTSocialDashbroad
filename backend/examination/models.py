import uuid
from django.db import models

class Competition(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    parent = models.CharField(max_length=100)
    organizer = models.CharField(max_length=255)
    sort_key = models.CharField(max_length=255)
    created_by = models.CharField(max_length=255, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.code})"

class ExamSession(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    competition_id = models.CharField(max_length=255)
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    parent = models.CharField(max_length=100)
    organizer = models.CharField(max_length=255)
    time = models.CharField(max_length=100)
    candidates_count = models.IntegerField(default=0)  # maps to candidates count in node
    national = models.CharField(max_length=100, blank=True, null=True)
    national_date = models.CharField(max_length=100, blank=True, null=True)
    international = models.CharField(max_length=100, blank=True, null=True)
    international_date = models.CharField(max_length=100, blank=True, null=True)
    phase = models.CharField(max_length=50, default='Chuẩn bị')
    note = models.TextField(blank=True, null=True)
    rounds = models.JSONField(default=list, blank=True)
    sort_key = models.CharField(max_length=255)
    created_by = models.CharField(max_length=255, blank=True, null=True)
    registration_sheet_url = models.CharField(max_length=1000, blank=True, default='')
    registration_sheet_tab = models.CharField(max_length=255, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class Candidate(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    school = models.CharField(max_length=255, blank=True, null=True)
    class_name = models.CharField(max_length=100, blank=True, null=True)  # maps to className
    city = models.CharField(max_length=100, blank=True, null=True)
    ward = models.CharField(max_length=255, blank=True, null=True)
    nationality = models.CharField(max_length=100, blank=True, null=True)
    grade = models.CharField(max_length=50, blank=True, null=True)
    contests = models.CharField(max_length=1000, blank=True, null=True)
    achievement = models.CharField(max_length=1000, blank=True, null=True)
    highest_round = models.CharField(max_length=255, blank=True, null=True)
    email = models.CharField(max_length=255, blank=True, null=True)
    parent = models.CharField(max_length=255, blank=True, null=True)
    phone = models.CharField(max_length=255, blank=True, null=True)
    identity = models.CharField(max_length=100, blank=True, null=True)
    address = models.CharField(max_length=1000, blank=True, null=True)
    birth_date = models.CharField(max_length=100, blank=True, null=True)
    session_ids = models.JSONField(default=list, blank=True)  # maps to sessionIds
    exam_history = models.JSONField(default=list, blank=True)
    sort_key = models.CharField(max_length=255)
    updated = models.CharField(max_length=100, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class CandidateParticipation(models.Model):
    """A candidate's membership in one yearly exam session/source tab."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='participations')
    session = models.ForeignKey(ExamSession, on_delete=models.CASCADE, related_name='participations')
    source = models.CharField(max_length=1000, blank=True, default='')
    subject = models.CharField(max_length=255, blank=True, default='')
    category = models.CharField(max_length=255, blank=True, default='')
    registration_method = models.CharField(max_length=255, blank=True, default='')
    registration_unit = models.CharField(max_length=1000, blank=True, default='')
    team_name = models.CharField(max_length=1000, blank=True, default='')
    exam_language = models.CharField(max_length=100, blank=True, default='')
    general_note = models.TextField(blank=True, default='')
    certificate_link = models.CharField(max_length=2000, blank=True, default='')
    registration_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['candidate', 'session'], name='unique_candidate_participation_per_session'),
        ]

    def __str__(self):
        return f"{self.candidate.code} / {self.session.code}"


class RoundResult(models.Model):
    """One round inside a participation. One imported tab can populate many rows."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    participation = models.ForeignKey(CandidateParticipation, on_delete=models.CASCADE, related_name='round_results')
    round_name = models.CharField(max_length=255)
    eligibility = models.CharField(max_length=1000, blank=True, default='')
    sbd = models.CharField(max_length=255, blank=True, default='')
    exam_date = models.CharField(max_length=255, blank=True, default='')
    time_slot = models.CharField(max_length=255, blank=True, default='')
    mode = models.CharField(max_length=255, blank=True, default='')
    location = models.CharField(max_length=1000, blank=True, default='')
    link = models.CharField(max_length=2000, blank=True, default='')
    account = models.CharField(max_length=1000, blank=True, default='')
    password = models.CharField(max_length=1000, blank=True, default='')
    attendance = models.CharField(max_length=255, blank=True, default='')
    score = models.CharField(max_length=255, blank=True, default='')
    score_rate = models.CharField(max_length=255, blank=True, default='')
    rank = models.CharField(max_length=255, blank=True, default='')
    result = models.CharField(max_length=1000, blank=True, default='')
    note = models.TextField(blank=True, default='')
    raw_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['participation', 'round_name'], name='unique_round_per_participation'),
        ]
        ordering = ['round_name']

    def __str__(self):
        return f"{self.participation} / {self.round_name}"


class LogNote(models.Model):
    # One immutable row per note. `key` is the entry identifier; `entity_key`
    # groups entries belonging to the same competition, session, candidate or class.
    key = models.CharField(max_length=255, primary_key=True)
    entity_key = models.CharField(max_length=255, db_index=True, default='')
    content = models.TextField()
    updated_by = models.CharField(max_length=255, blank=True, null=True)
    actor_email = models.EmailField(blank=True, null=True)
    actor_photo_url = models.CharField(max_length=1000, blank=True, null=True)
    system = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key

class ExaminationSheet(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    name = models.CharField(max_length=255)
    url = models.CharField(max_length=1000)
    status = models.CharField(max_length=50, default='idle')
    session_id = models.CharField(max_length=255, blank=True, default='')
    sheet_tab = models.CharField(max_length=255, blank=True, default='')
    stage = models.CharField(max_length=100, blank=True, default='')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    created_by = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        return self.name


class ExaminationSheetPublication(models.Model):
    """One read-only Google Sheets publication workbook per academic year."""
    academic_year = models.CharField(max_length=20, unique=True, default='')
    spreadsheet_url = models.CharField(max_length=1000, blank=True, default='')
    enabled = models.BooleanField(default=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=30, default='idle')
    last_error = models.TextField(blank=True, default='')
    last_summary = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Google Sheets publication'
        verbose_name_plural = 'Google Sheets publications'

    def __str__(self):
        return self.spreadsheet_url or 'Google Sheets publication not configured'


class Blueprint(models.Model):
    """Reusable assessment blueprint. Slots only live in immutable versions."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=500)
    competition = models.ForeignKey(Competition, on_delete=models.SET_NULL, null=True, blank=True, related_name='blueprints')
    session = models.ForeignKey(ExamSession, on_delete=models.SET_NULL, null=True, blank=True, related_name='blueprints')
    round_name = models.CharField(max_length=255, blank=True, default='')
    subject = models.CharField(max_length=255, blank=True, default='')
    grade_or_category = models.CharField(max_length=255, blank=True, default='')
    language = models.CharField(max_length=50, default='Tiếng Việt')
    duration_minutes = models.PositiveIntegerField(default=60)
    metadata_schema = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True, default='')
    created_by = models.CharField(max_length=255, blank=True, default='')
    updated_by = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.name


class BlueprintVersion(models.Model):
    STATUS_DRAFT = 'DRAFT'
    STATUS_LOCKED = 'LOCKED'
    STATUS_ARCHIVED = 'ARCHIVED'
    STATUS_CHOICES = [(STATUS_DRAFT, 'Bản nháp'), (STATUS_LOCKED, 'Đã khóa'), (STATUS_ARCHIVED, 'Lưu trữ')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    blueprint = models.ForeignKey(Blueprint, on_delete=models.CASCADE, related_name='versions')
    version_number = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    note = models.TextField(blank=True, default='')
    analysis = models.JSONField(default=dict, blank=True)
    created_by = models.CharField(max_length=255, blank=True, default='')
    locked_by = models.CharField(max_length=255, blank=True, default='')
    locked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-version_number']
        constraints = [models.UniqueConstraint(fields=['blueprint', 'version_number'], name='unique_blueprint_version_number')]

    def __str__(self):
        return f'{self.blueprint.name} v{self.version_number}'


class BlueprintSlot(models.Model):
    QUESTION_TYPES = [('single_choice', 'Trắc nghiệm một đáp án'), ('numeric_input', 'Điền đáp số')]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    version = models.ForeignKey(BlueprintVersion, on_delete=models.CASCADE, related_name='slots')
    position = models.PositiveIntegerField()
    question_type = models.CharField(max_length=40, choices=QUESTION_TYPES, default='single_choice')
    option_count = models.PositiveSmallIntegerField(default=4)
    score = models.DecimalField(max_digits=8, decimal_places=2, default=1)
    difficulty = models.CharField(max_length=20, choices=ExamQuestion.DIFFICULTIES if 'ExamQuestion' in globals() else [('EASY', 'Dễ'), ('MEDIUM', 'Trung bình'), ('HARD', 'Khó'), ('VERY_HARD', 'Rất khó')], default='MEDIUM')
    topic = models.CharField(max_length=255, blank=True, default='')
    knowledge_source = models.CharField(max_length=500, blank=True, default='')
    knowledge_requirements = models.TextField(blank=True, default='')
    prohibited_knowledge = models.TextField(blank=True, default='')
    assessment_intent = models.TextField(blank=True, default='')
    estimated_seconds = models.PositiveIntegerField(default=90)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['position']
        constraints = [models.UniqueConstraint(fields=['version', 'position'], name='unique_blueprint_slot_position')]


class ExamGenerationJob(models.Model):
    STATUS_CHOICES = [('QUEUED', 'Đang chờ'), ('GENERATING', 'Đang sinh'), ('COMPLETED', 'Hoàn thành'), ('FAILED', 'Lỗi')]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paper = models.ForeignKey('ExamPaper', on_delete=models.CASCADE, related_name='generation_jobs')
    blueprint_version = models.ForeignKey(BlueprintVersion, on_delete=models.PROTECT, related_name='generation_jobs')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='QUEUED')
    message = models.CharField(max_length=500, blank=True, default='')
    requested_by = models.CharField(max_length=255, blank=True, default='')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

class ExamPaper(models.Model):
    STATUS_DRAFT = 'DRAFT'
    STATUS_AI_REVIEW = 'AI_REVIEW'
    STATUS_STAFF_PRECHECK = 'STAFF_PRECHECK'
    STATUS_DRAFT_EXPORTED = 'DRAFT_EXPORTED'
    STATUS_PEER_REVIEW = 'PEER_REVIEW'
    STATUS_AWAITING_APPROVAL = 'AWAITING_APPROVAL'
    STATUS_APPROVED = 'APPROVED'
    STATUS_OFFICIAL = 'OFFICIAL'
    STATUS_BANKED = 'BANKED'
    STATUS_NEEDS_REVISION = 'NEEDS_REVISION'
    STATUS_ARCHIVED = 'ARCHIVED'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Đề nháp'), (STATUS_AI_REVIEW, 'AI kiểm tra sơ bộ'),
        (STATUS_STAFF_PRECHECK, 'Nhân viên kiểm tra sơ bộ'), (STATUS_DRAFT_EXPORTED, 'Đã xuất và lưu đề nháp'),
        (STATUS_PEER_REVIEW, 'Đang phản biện'), (STATUS_AWAITING_APPROVAL, 'Chờ phê duyệt'),
        (STATUS_APPROVED, 'Đã phê duyệt'), (STATUS_OFFICIAL, 'Đề chính thức'),
        (STATUS_BANKED, 'Đã lưu ngân hàng'), (STATUS_NEEDS_REVISION, 'Cần chỉnh sửa'),
        (STATUS_ARCHIVED, 'Lưu trữ'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=500)
    competition = models.ForeignKey(Competition, on_delete=models.SET_NULL, null=True, blank=True, related_name='exam_papers')
    session = models.ForeignKey(ExamSession, on_delete=models.SET_NULL, null=True, blank=True, related_name='exam_papers')
    blueprint_version = models.ForeignKey(BlueprintVersion, on_delete=models.PROTECT, null=True, blank=True, related_name='exam_papers')
    subject = models.CharField(max_length=255, blank=True, default='')
    grade_or_category = models.CharField(max_length=255, blank=True, default='')
    language = models.CharField(max_length=50, default='Tiếng Việt')
    duration_minutes = models.PositiveIntegerField(default=60)
    total_questions = models.PositiveIntegerField(default=0)
    difficulty_distribution = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    description = models.TextField(blank=True, default='')
    ai_generation_status = models.CharField(max_length=30, blank=True, default='idle')
    ai_generation_message = models.CharField(max_length=500, blank=True, default='')
    quality_report = models.JSONField(default=dict, blank=True)
    workflow_log = models.JSONField(default=list, blank=True)
    draft_exported_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.CharField(max_length=255, blank=True, default='')
    official_exported_at = models.DateTimeField(null=True, blank=True)
    banked_at = models.DateTimeField(null=True, blank=True)
    created_by = models.CharField(max_length=255, blank=True, default='')
    updated_by = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.title


class ExamQuestion(models.Model):
    DIFFICULTIES = [('EASY', 'Dễ'), ('MEDIUM', 'Trung bình'), ('HARD', 'Khó'), ('VERY_HARD', 'Rất khó')]
    CHECK_STATUS = [('PENDING', 'Chưa kiểm tra'), ('PASSED', 'Đạt yêu cầu'), ('AI_FIXED', 'Đã được AI chỉnh sửa'), ('NEEDS_REVIEW', 'Cần người dùng kiểm tra'), ('WARNING', 'Có cảnh báo')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paper = models.ForeignKey(ExamPaper, on_delete=models.CASCADE, related_name='questions')
    blueprint_slot = models.ForeignKey(BlueprintSlot, on_delete=models.PROTECT, null=True, blank=True, related_name='questions')
    question_type = models.CharField(max_length=40, default='single_choice')
    score = models.DecimalField(max_digits=8, decimal_places=2, default=1)
    slot_metadata = models.JSONField(default=dict, blank=True)
    order = models.PositiveIntegerField(default=1)
    content = models.TextField()
    choices = models.JSONField(default=list)  # Designed for future variable option counts; MVP validates A-D.
    correct_answer = models.CharField(max_length=10)
    explanation = models.TextField(blank=True, default='')
    difficulty = models.CharField(max_length=20, choices=DIFFICULTIES, default='MEDIUM')
    topic = models.CharField(max_length=255, blank=True, default='')
    check_status = models.CharField(max_length=30, choices=CHECK_STATUS, default='PENDING')
    warnings = models.JSONField(default=list, blank=True)
    ai_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'created_at']
        constraints = [models.UniqueConstraint(fields=['paper', 'order'], name='unique_question_order_per_paper')]


class ExamReview(models.Model):
    SCOPE_QUESTION = 'QUESTION'
    SCOPE_PAPER = 'PAPER'
    SCOPE_CHOICES = [(SCOPE_QUESTION, 'Phản biện câu'), (SCOPE_PAPER, 'Phản biện đề')]
    VERDICT_PENDING = 'PENDING'
    VERDICT_PASSED = 'PASSED'
    VERDICT_REVISION_REQUIRED = 'REVISION_REQUIRED'
    VERDICT_CHOICES = [
        (VERDICT_PENDING, 'Chưa kết luận'), (VERDICT_PASSED, 'Đạt'),
        (VERDICT_REVISION_REQUIRED, 'Yêu cầu chỉnh sửa'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paper = models.ForeignKey(ExamPaper, on_delete=models.CASCADE, related_name='human_reviews')
    question = models.ForeignKey(ExamQuestion, on_delete=models.CASCADE, null=True, blank=True, related_name='human_reviews')
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES)
    verdict = models.CharField(max_length=30, choices=VERDICT_CHOICES, default=VERDICT_PENDING)
    notes = models.TextField(blank=True, default='')
    checks = models.JSONField(default=dict, blank=True)
    reviewer = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']


class ExamSourceDocument(models.Model):
    SOURCE_TYPES = [('UPLOAD', 'Tệp tải lên'), ('PAPER', 'Đề trong kho'), ('SYLLABUS', 'Syllabus'), ('DESCRIPTION', 'Mô tả')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paper = models.ForeignKey(ExamPaper, on_delete=models.CASCADE, related_name='sources')
    source_type = models.CharField(max_length=30, choices=SOURCE_TYPES)
    name = models.CharField(max_length=500)
    file = models.FileField(upload_to='exam-paper-sources/%Y/%m/', blank=True, null=True)
    referenced_paper = models.ForeignKey(ExamPaper, on_delete=models.SET_NULL, blank=True, null=True, related_name='used_as_source_by')
    extracted_text = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)


class AiProviderConfig(models.Model):
    provider = models.CharField(max_length=100, unique=True, default='openai')
    base_url = models.URLField(blank=True, default='https://api.openai.com/v1')
    api_key_encrypted = models.TextField(blank=True, default='')
    generation_model = models.CharField(max_length=255, blank=True, default='gpt-4.1-mini')
    review_model = models.CharField(max_length=255, blank=True, default='gpt-4.1-mini')
    temperature = models.FloatField(default=0.4)
    max_tokens = models.PositiveIntegerField(default=12000)
    timeout_seconds = models.PositiveIntegerField(default=120)
    max_retries = models.PositiveIntegerField(default=2)
    updated_by = models.CharField(max_length=255, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)


class AiUsageLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paper = models.ForeignKey(ExamPaper, on_delete=models.SET_NULL, null=True, blank=True, related_name='ai_usage_logs')
    user_email = models.CharField(max_length=255, blank=True, default='')
    task_type = models.CharField(max_length=100)
    provider = models.CharField(max_length=100, default='openai')
    model = models.CharField(max_length=255, blank=True, default='')
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    estimated_cost = models.DecimalField(max_digits=12, decimal_places=6, default=0)
    duration_ms = models.PositiveIntegerField(default=0)
    success = models.BooleanField(default=False)
    error_message = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
