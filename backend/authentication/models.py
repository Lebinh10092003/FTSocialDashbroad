from django.db import models


class Department(models.Model):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=30, blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class JobTitle(models.Model):
    name = models.CharField(max_length=120, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class UserProfile(models.Model):
    email = models.EmailField(primary_key=True)
    name = models.CharField(max_length=255, blank=True, null=True)
    role = models.CharField(max_length=50, default='EMPLOYEE')
    photo_url = models.CharField(max_length=1000, blank=True, null=True)
    employee_code = models.CharField(max_length=50, blank=True, null=True, unique=True)
    phone = models.CharField(max_length=30, blank=True, default='')
    department = models.ForeignKey(Department, blank=True, null=True, on_delete=models.SET_NULL, related_name='employees')
    job_title = models.ForeignKey(JobTitle, blank=True, null=True, on_delete=models.SET_NULL, related_name='employees')
    manager = models.ForeignKey('self', blank=True, null=True, on_delete=models.SET_NULL, related_name='direct_reports')
    start_date = models.DateField(blank=True, null=True)
    employment_status = models.CharField(max_length=30, default='ACTIVE')
    access_modules = models.JSONField(default=list, blank=True)
    last_login = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.email} ({self.role})'


class UserLogin(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    email = models.CharField(max_length=255)
    name = models.CharField(max_length=255, blank=True, null=True)
    role = models.CharField(max_length=50)
    login_at = models.DateTimeField()
    user_agent = models.TextField(blank=True, null=True)
    ip = models.CharField(max_length=50, blank=True, null=True)

    def __str__(self):
        return f'{self.email} at {self.login_at}'


class SystemConfig(models.Model):
    key = models.CharField(max_length=255, primary_key=True)
    admin_emails = models.TextField(blank=True, null=True)
    last_google_access_token = models.TextField(blank=True, null=True)
    last_google_access_token_time = models.DateTimeField(null=True, blank=True)
    data = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.key