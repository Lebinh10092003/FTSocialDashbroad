from django.db import migrations


def reset_legacy_template_visibility(apps, schema_editor):
    """Undo the prior migration that unintentionally shared every existing template."""
    EmailTemplate = apps.get_model('email_builder', 'EmailTemplate')
    EmailTemplate.objects.filter(is_published=True).update(
        is_published=False,
        published_at=None,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('email_builder', '0002_template_visibility'),
    ]

    operations = [
        migrations.RunPython(reset_legacy_template_visibility, migrations.RunPython.noop),
    ]