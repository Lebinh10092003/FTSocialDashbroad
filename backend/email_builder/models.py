from django.db import models

class EmailTemplate(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    name = models.CharField(max_length=255)
    subject = models.CharField(max_length=1000, blank=True, default='')
    settings = models.JSONField(default=dict, blank=True)
    blocks = models.JSONField(default=list, blank=True)
    last_updated = models.BigIntegerField()
    created_by = models.CharField(max_length=255)
    updated_by = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class EmailUserPref(models.Model):
    email = models.CharField(max_length=255, primary_key=True)
    active_template_id = models.CharField(max_length=255, null=True, blank=True)
    left_panel_width = models.IntegerField(default=152)
    right_panel_width = models.IntegerField(default=300)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.email
