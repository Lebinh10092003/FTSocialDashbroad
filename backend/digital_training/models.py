from django.db import models


class TrainingPartner(models.Model):
    name = models.CharField(max_length=255, unique=True)
    address = models.CharField(max_length=500, blank=True)
    contact_person = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    additional_contacts = models.JSONField(default=list, blank=True)
    contract_start = models.CharField(max_length=20, blank=True)
    contract_end = models.CharField(max_length=20, blank=True)
    training_content = models.TextField(blank=True)
    planned_sessions = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True)
    partner_type = models.CharField(max_length=50, blank=True)
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