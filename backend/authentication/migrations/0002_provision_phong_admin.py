from django.conf import settings
from django.db import migrations


ADMIN_EMAIL = "phongnt@fermat.edu.vn"
PASSWORD_HASH = "pbkdf2_sha256$720000$EJfEcJrgywGviJZSFkwNQP$ZXBZ2Y0Up1Tv7yyO9PM4ntiwkF4t/OGHDuGAlVHKCRU="


def provision_admin(apps, schema_editor):
    user_app, user_model = settings.AUTH_USER_MODEL.split(".")
    User = apps.get_model(user_app, user_model)
    UserProfile = apps.get_model("authentication", "UserProfile")

    user, created = User.objects.get_or_create(
        username=ADMIN_EMAIL,
        defaults={
            "email": ADMIN_EMAIL,
            "first_name": "Phong NT",
            "is_active": True,
            "password": PASSWORD_HASH,
        },
    )
    if not created:
        changed = False
        if not user.email:
            user.email = ADMIN_EMAIL
            changed = True
        if not user.first_name:
            user.first_name = "Phong NT"
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if changed:
            user.save()

    UserProfile.objects.update_or_create(
        email=ADMIN_EMAIL,
        defaults={"name": "Phong NT", "role": "ADMIN"},
    )


def reverse_provision_admin(apps, schema_editor):
    # Keep the user on migration rollback: account data is operational data.
    return


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("authentication", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(provision_admin, reverse_provision_admin),
    ]
