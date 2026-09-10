from django.db import migrations


def seed_links(apps, schema_editor):
    SystemConfig = apps.get_model("authentication", "SystemConfig")
    config, _ = SystemConfig.objects.get_or_create(key="monthly_sheet_links", defaults={"data": {}})
    data = dict(config.data) if isinstance(config.data, dict) else {}
    links = dict(data.get("links")) if isinstance(data.get("links"), dict) else {}
    attendance = dict(links.get("attendance")) if isinstance(links.get("attendance"), dict) else {}
    schedule = dict(links.get("work_schedule")) if isinstance(links.get("work_schedule"), dict) else {}
    attendance.setdefault("2026-09", "https://docs.google.com/spreadsheets/d/13g9wVXObE0185_bHaH9WlutrJ3zm_VlA/edit?gid=514890939#gid=514890939")
    schedule.setdefault("2026-09", "https://docs.google.com/spreadsheets/d/1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc/edit")
    links.update({"attendance": attendance, "work_schedule": schedule})
    data["links"] = links
    config.data = data
    config.save(update_fields=["data"])


class Migration(migrations.Migration):
    dependencies = [("authentication", "0014_workspace_notifications")]
    operations = [migrations.RunPython(seed_links, migrations.RunPython.noop)]
