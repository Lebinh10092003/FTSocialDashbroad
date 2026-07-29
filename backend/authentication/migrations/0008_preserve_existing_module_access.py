from django.db import migrations


MODULES = ["social-dashboard", "email-builder", "examination", "digital-training"]


def preserve_existing_access(apps, schema_editor):
    UserProfile = apps.get_model("authentication", "UserProfile")
    UserProfile.objects.filter(access_modules=[]).update(access_modules=MODULES)


class Migration(migrations.Migration):
    dependencies = [("authentication", "0007_userprofile_access_modules")]
    operations = [migrations.RunPython(preserve_existing_access, migrations.RunPython.noop)]