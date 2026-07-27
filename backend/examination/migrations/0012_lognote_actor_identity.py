from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('examination', '0011_aiproviderconfig_exampaper_aiusagelog_examquestion_and_more')]
    operations = [
        migrations.AddField(model_name='lognote', name='actor_email', field=models.EmailField(blank=True, max_length=254, null=True)),
        migrations.AddField(model_name='lognote', name='actor_photo_url', field=models.CharField(blank=True, max_length=1000, null=True)),
    ]