from django.db import migrations


MODULE = "work-schedule"


def add_work_schedule_access(apps, schema_editor):
    UserProfile = apps.get_model("authentication", "UserProfile")
    for profile in UserProfile.objects.all().iterator():
        current = set(profile.access_modules or [])
        if MODULE in current:
            continue
        profile.access_modules = sorted(current | {MODULE})
        profile.save(update_fields=["access_modules"])


def remove_work_schedule_access(apps, schema_editor):
    UserProfile = apps.get_model("authentication", "UserProfile")
    for profile in UserProfile.objects.all().iterator():
        current = set(profile.access_modules or [])
        if MODULE not in current:
            continue
        profile.access_modules = sorted(current - {MODULE})
        profile.save(update_fields=["access_modules"])


class Migration(migrations.Migration):
    dependencies = [("authentication", "0011_add_default_workspace_module_access")]

    operations = [migrations.RunPython(add_work_schedule_access, remove_work_schedule_access)]
