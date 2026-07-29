from django.db import migrations


DEFAULT_TITLES = [
    "Giám đốc",
    "Phó Giám đốc",
    "Trưởng phòng",
    "Phó phòng",
    "Chuyên viên",
    "Nhân viên",
    "Cộng tác viên",
    "Thực tập sinh",
]


def seed_job_titles(apps, schema_editor):
    JobTitle = apps.get_model("authentication", "JobTitle")
    for name in DEFAULT_TITLES:
        JobTitle.objects.get_or_create(name=name, defaults={"is_active": True})


def unseed_job_titles(apps, schema_editor):
    JobTitle = apps.get_model("authentication", "JobTitle")
    JobTitle.objects.filter(name__in=DEFAULT_TITLES).delete()


class Migration(migrations.Migration):
    dependencies = [("authentication", "0005_department_jobtitle_userprofile_employee_code_and_more")]
    operations = [migrations.RunPython(seed_job_titles, unseed_job_titles)]