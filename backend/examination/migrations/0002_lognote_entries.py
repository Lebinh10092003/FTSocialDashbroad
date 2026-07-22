# Generated manually to preserve existing lognote history as individual entries.
import json
import uuid
from datetime import datetime

from django.db import migrations, models
from django.utils import timezone
from django.utils.dateparse import parse_datetime


def parse_legacy_time(value, fallback):
    if not value:
        return fallback
    if isinstance(value, str):
        parsed = parse_datetime(value)
        if parsed:
            return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)
        for pattern in ('%d/%m/%Y %H:%M', '%d/%m/%Y, %H:%M:%S'):
            try:
                return timezone.make_aware(datetime.strptime(value, pattern))
            except ValueError:
                pass
    return fallback


def split_legacy_lognotes(apps, schema_editor):
    LogNote = apps.get_model('examination', 'LogNote')
    legacy_rows = list(LogNote.objects.filter(entity_key=''))
    for legacy in legacy_rows:
        try:
            entries = json.loads(legacy.content or '[]')
        except (TypeError, json.JSONDecodeError):
            entries = []
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict) or not str(entry.get('content', '')).strip():
                    continue
                entry_key = f'{legacy.key}:{uuid.uuid4().hex}'
                created_at = parse_legacy_time(entry.get('createdAt') or entry.get('time'), legacy.updated_at)
                LogNote.objects.create(
                    key=entry_key,
                    entity_key=legacy.key,
                    content=str(entry.get('content', '')).strip(),
                    updated_by=str(entry.get('actor') or legacy.updated_by or 'Nhân viên FT Workspace'),
                    system=bool(entry.get('system', False)),
                )
                LogNote.objects.filter(key=entry_key).update(created_at=created_at, updated_at=legacy.updated_at)
        legacy.delete()


class Migration(migrations.Migration):
    dependencies = [('examination', '0001_initial')]

    operations = [
        migrations.AddField(
            model_name='lognote',
            name='entity_key',
            field=models.CharField(db_index=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='lognote',
            name='system',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='lognote',
            name='created_at',
            field=models.DateTimeField(null=True),
        ),
        migrations.RunPython(split_legacy_lognotes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='lognote',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True),
        ),
    ]
