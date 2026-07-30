import uuid

from django.db import models
from django.utils.text import slugify


class TrainingPartner(models.Model):
    name = models.CharField(max_length=255, unique=True)
    address = models.CharField(max_length=500, blank=True)
    contact_person = models.CharField(max_length=255, blank=True)
    contact_position = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    additional_contacts = models.JSONField(default=list, blank=True)
    contract_start = models.CharField(max_length=20, blank=True)
    contract_end = models.CharField(max_length=20, blank=True)
    training_content = models.TextField(blank=True)
    planned_sessions = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True)
    partner_type = models.CharField(max_length=50, blank=True)
    partner_subtype = models.CharField(max_length=100, blank=True)
    province = models.CharField(max_length=100, blank=True, default='')
    ward = models.CharField(max_length=255, blank=True)
    products = models.JSONField(default=list, blank=True)
    contract_duration = models.PositiveIntegerField(null=True, blank=True)
    contract_duration_unit = models.CharField(max_length=10, blank=True)
    contract_signed_date = models.DateField(null=True, blank=True)
    contract_status = models.CharField(max_length=30, blank=True)
    budget = models.DecimalField(max_digits=15, decimal_places=0, null=True, blank=True)
    ai_account_count = models.PositiveIntegerField(default=0)
    training_contents = models.JSONField(default=list, blank=True)
    training_schedule = models.JSONField(default=list, blank=True)
    training_location = models.CharField(max_length=500, blank=True)
    training_staff = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]


class TrainingClass(models.Model):
    partner = models.ForeignKey(TrainingPartner, on_delete=models.CASCADE, related_name="classes")
    name = models.CharField(max_length=255)
    members = models.CharField(max_length=500, blank=True)
    planned_sessions = models.PositiveIntegerField(default=0)
    training_contents = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["partner__name", "name"]
        constraints = [models.UniqueConstraint(fields=["partner", "name"], name="unique_training_class_per_partner")]


class TrainingSession(models.Model):
    STATUS_CHOICES = [("unscheduled", "Unscheduled"), ("planned", "Scheduled"), ("completed", "Completed"), ("cancelled", "Cancelled")]
    title = models.CharField(max_length=255)
    session_number = models.PositiveIntegerField(null=True, blank=True)
    session_date = models.DateField(null=True, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    partner = models.CharField(max_length=255, blank=True)
    partner_ref = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions")
    training_class = models.ForeignKey(TrainingClass, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions")
    category = models.CharField(max_length=255, blank=True)
    contents = models.JSONField(default=list, blank=True)
    attendees = models.PositiveIntegerField(default=0)
    location = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="planned")
    notes = models.TextField(blank=True)
    staff_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["session_date", "start_time", "title"]


class TrainingCustomerMeeting(models.Model):
    """A work-calendar entry for either a new-customer meeting or another activity."""

    SCHEDULE_TYPES = [
        ("meeting", "Customer meeting"),
        ("other", "Other work activity"),
    ]

    title = models.CharField(max_length=255)
    schedule_type = models.CharField(max_length=20, choices=SCHEDULE_TYPES, default="meeting")
    activity_type = models.CharField(max_length=100, blank=True)
    customer_type = models.CharField(max_length=100, blank=True)
    representative = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    meeting_date = models.DateField()
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    location = models.CharField(max_length=500, blank=True)
    content = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=TrainingSession.STATUS_CHOICES, default="planned")
    staff_name = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["meeting_date", "start_time", "title"]

class TrainingMaterial(models.Model):
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to="digital-training/materials/%Y/%m/", blank=True)
    external_url = models.URLField(blank=True)
    file_name = models.CharField(max_length=500, blank=True)
    file_type = models.CharField(max_length=100, blank=True)
    session = models.ForeignKey(TrainingSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="materials")
    partner = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="materials")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "title"]


class TrainingSurvey(models.Model):
    FORM_TYPES = [("end_session", "End session"), ("end_course", "End course")]
    title = models.CharField(max_length=255)
    form_type = models.CharField(max_length=20, choices=FORM_TYPES)
    session = models.ForeignKey(TrainingSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="surveys")
    partner = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="surveys")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "title"]


class TrainingAssessment(models.Model):
    STATUS_CHOICES = [("draft", "Draft"), ("published", "Published"), ("closed", "Closed")]
    GENERATION_MODE_CHOICES = [("prepared", "Prepared variants"), ("auto_generate", "Auto-generate from import")]
    title = models.CharField(max_length=255)
    session = models.ForeignKey(TrainingSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="assessments")
    partner = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="assessments")
    training_class = models.ForeignKey(TrainingClass, null=True, blank=True, on_delete=models.SET_NULL, related_name="assessments")
    description = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
    duration_minutes = models.PositiveIntegerField(default=30)
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)
    attempt_limit = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    public_slug = models.SlugField(max_length=255, unique=True, editable=False)
    questions = models.JSONField(default=list, blank=True)
    generation_mode = models.CharField(
        max_length=30,
        choices=GENERATION_MODE_CHOICES,
        default="prepared",
    )
    generation_config = models.JSONField(default=dict, blank=True)
    source_type = models.CharField(max_length=20, blank=True)
    source_name = models.CharField(max_length=500, blank=True)
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "title"]

    def save(self, *args, **kwargs):
        if not self.public_slug:
            label = " ".join(
                value for value in [
                    self.partner.name if self.partner else "",
                    self.training_class.name if self.training_class else "",
                ] if value
            )
            label = label.replace("Đ", "D").replace("đ", "d")
            self.public_slug = slugify(label) or f"training-assessment-{uuid.uuid4().hex[:8]}"
        super().save(*args, **kwargs)


class TrainingAssessmentAttempt(models.Model):
    STATUS_CHOICES = [("in_progress", "In progress"), ("submitted", "Submitted"), ("timed_out", "Timed out")]
    assessment = models.ForeignKey(TrainingAssessment, on_delete=models.CASCADE, related_name="attempts")
    access_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    respondent_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    organization = models.CharField(max_length=255, blank=True)
    variant = models.CharField(max_length=100)
    answers = models.JSONField(default=dict, blank=True)
    score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    max_score = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    auto_graded_points = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    manual_grading_required = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="in_progress")
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    submitted_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]


class TrainingAssessmentUpload(models.Model):
    attempt = models.ForeignKey(TrainingAssessmentAttempt, on_delete=models.CASCADE, related_name="uploads")
    question_id = models.CharField(max_length=100)
    file = models.FileField(upload_to="digital-training/assessment-answers/%Y/%m/")
    original_name = models.CharField(max_length=500)
    content_type = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
