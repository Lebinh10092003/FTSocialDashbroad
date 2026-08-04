from django.db import migrations, models
from django.utils import timezone


def publish_existing_templates(apps, schema_editor):
    EmailTemplate = apps.get_model('email_builder', 'EmailTemplate')
    EmailTemplate.objects.filter(is_published=False).update(
        is_published=True,
        published_at=timezone.now(),
    )


class Migration(migrations.Migration):

    dependencies = [
        ('email_builder', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='emailtemplate',
            name='is_published',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='emailtemplate',
            name='published_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(publish_existing_templates, migrations.RunPython.noop),
    ]
