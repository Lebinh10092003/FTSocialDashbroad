from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import migrations


EMAIL = "dungpv@fermat.edu.vn"
DEFAULT_PASSWORD = "Ft@12345"
MODULES = [
    "attendance",
    "digital-training",
    "email-builder",
    "examination",
    "finance-report",
    "qr-generator",
    "signature-builder",
    "social-dashboard",
    "work-schedule",
]


def provision_mr_dung(apps, schema_editor):
    user_app, user_model = settings.AUTH_USER_MODEL.split(".")
    User = apps.get_model(user_app, user_model)
    UserProfile = apps.get_model("authentication", "UserProfile")
    Department = apps.get_model("authentication", "Department")
    JobTitle = apps.get_model("authentication", "JobTitle")

    department, _ = Department.objects.get_or_create(
        name="Ban Lãnh đạo", defaults={"code": "BLĐ", "is_active": True}
    )
    title, _ = JobTitle.objects.get_or_create(
        name="Phó Giám đốc phụ trách Khảo thí, Truyền thông",
        defaults={"is_active": True},
    )
    user, _ = User.objects.get_or_create(username=EMAIL, defaults={"email": EMAIL})
    user.email = EMAIL
    user.first_name = "Mr Dũng"
    user.is_active = True
    user.password = make_password(DEFAULT_PASSWORD)
    user.save()

    profile, _ = UserProfile.objects.update_or_create(
        email=EMAIL,
        defaults={
            "name": "Mr Dũng",
            "employee_code": "FT -02",
            "role": "MANAGER",
            "employment_status": "ACTIVE",
            "department": department,
            "job_title": title,
            "access_modules": MODULES,
        },
    )
    profile.departments.add(department)
    UserProfile.objects.filter(
        email__in=["phongnt@fermat.edu.vn", "phuongnt@fermat.edu.vn"]
    ).update(manager=profile)


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("authentication", "0012_add_work_schedule_module_access"),
    ]

    operations = [migrations.RunPython(provision_mr_dung, migrations.RunPython.noop)]
