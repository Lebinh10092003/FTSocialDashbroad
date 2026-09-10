from django.db import migrations


NEW_URL = "https://docs.google.com/spreadsheets/d/1OvmMuvQuquVyTyjZVm8yDGryWz6Lp5vIny3Ttei7SH8/edit"
OLD_ID = "13g9wVXObE0185_bHaH9WlutrJ3zm_VlA"


def update_link(apps, schema_editor):
    SystemConfig = apps.get_model("authentication", "SystemConfig")
    config, _ = SystemConfig.objects.get_or_create(
        key="monthly_sheet_links", defaults={"data": {"links": {}}}
    )
    data = dict(config.data) if isinstance(config.data, dict) else {}
    links = dict(data.get("links")) if isinstance(data.get("links"), dict) else {}
    attendance = dict(links.get("attendance")) if isinstance(links.get("attendance"), dict) else {}
    current = str(attendance.get("2026-09") or "")
    if not current or OLD_ID in current:
        attendance["2026-09"] = NEW_URL
        links["attendance"] = attendance
        data["links"] = links
        config.data = data
        config.save(update_fields=["data"])


class Migration(migrations.Migration):
    dependencies = [("authentication", "0015_seed_monthly_sheet_links")]
    operations = [migrations.RunPython(update_link, migrations.RunPython.noop)]
