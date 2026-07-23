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
