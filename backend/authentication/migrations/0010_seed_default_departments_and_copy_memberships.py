from django.db import migrations


def copy_legacy_department_memberships(apps, schema_editor):
    UserProfile = apps.get_model("authentication", "UserProfile")

    for profile in UserProfile.objects.exclude(department__isnull=True).iterator():
        profile.departments.add(profile.department_id)

class Migration(migrations.Migration):
    dependencies = [("authentication", "0009_userprofile_departments")]
    operations = [migrations.RunPython(copy_legacy_department_memberships, migrations.RunPython.noop)]
