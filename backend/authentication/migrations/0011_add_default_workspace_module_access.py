from django.db import migrations


DEFAULT_MODULES = {"attendance", "email-builder", "signature-builder", "qr-generator"}


def add_default_workspace_modules(apps, schema_editor):
    UserProfile = apps.get_model("authentication", "UserProfile")
    for profile in UserProfile.objects.all().iterator():
        current = set(profile.access_modules or [])
        updated = sorted(current | DEFAULT_MODULES)
        if updated != sorted(current):
            profile.access_modules = updated
            profile.save(update_fields=["access_modules"])


class Migration(migrations.Migration):
    dependencies = [("authentication", "0010_seed_default_departments_and_copy_memberships")]

    operations = [migrations.RunPython(add_default_workspace_modules, migrations.RunPython.noop)]
