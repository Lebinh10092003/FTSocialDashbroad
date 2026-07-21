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
    contests = models.CharField(max_length=1000, blank=True, null=True)
    achievement = models.CharField(max_length=1000, blank=True, null=True)
    email = models.CharField(max_length=255, blank=True, null=True)
    parent = models.CharField(max_length=255, blank=True, null=True)
    phone = models.CharField(max_length=255, blank=True, null=True)
    identity = models.CharField(max_length=100, blank=True, null=True)
    address = models.CharField(max_length=1000, blank=True, null=True)
    birth_date = models.CharField(max_length=100, blank=True, null=True)
    session_ids = models.JSONField(default=list, blank=True)  # maps to sessionIds
    sort_key = models.CharField(max_length=255)
    updated = models.CharField(max_length=100, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class LogNote(models.Model):
    key = models.CharField(max_length=255, primary_key=True)
    content = models.TextField()
    updated_by = models.CharField(max_length=255, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key

class ExaminationSheet(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    name = models.CharField(max_length=255)
    url = models.CharField(max_length=1000)
    status = models.CharField(max_length=50, default='idle')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    created_by = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        return self.name
