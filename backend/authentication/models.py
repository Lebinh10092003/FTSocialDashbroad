from django.db import models

class UserProfile(models.Model):
    email = models.EmailField(primary_key=True)
    name = models.CharField(max_length=255, blank=True, null=True)
    role = models.CharField(max_length=50, default='EMPLOYEE')
    photo_url = models.CharField(max_length=1000, blank=True, null=True)
    last_login = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.email} ({self.role})"

class UserLogin(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    email = models.CharField(max_length=255)
    name = models.CharField(max_length=255, blank=True, null=True)
    role = models.CharField(max_length=50)
    login_at = models.DateTimeField()
    user_agent = models.TextField(blank=True, null=True)
    ip = models.CharField(max_length=50, blank=True, null=True)

    def __str__(self):
        return f"{self.email} at {self.login_at}"

class SystemConfig(models.Model):
    key = models.CharField(max_length=255, primary_key=True)
    admin_emails = models.TextField(blank=True, null=True)
    last_google_access_token = models.TextField(blank=True, null=True)
    last_google_access_token_time = models.DateTimeField(null=True, blank=True)
    data = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.key
