from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('authentication', '0013_provision_mr_dung')]

    operations = [
        migrations.CreateModel(
            name='WorkspaceNotification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_key', models.CharField(max_length=255, unique=True)),
                ('title', models.CharField(max_length=255)),
                ('message', models.TextField()),
                ('category', models.CharField(default='workspace', max_length=80)),
                ('severity', models.CharField(choices=[('info', 'Thông tin'), ('warning', 'Cảnh báo'), ('urgent', 'Khẩn'), ('success', 'Thành công')], default='info', max_length=20)),
                ('action_url', models.CharField(blank=True, default='', max_length=1000)),
                ('target_roles', models.JSONField(blank=True, default=list)),
                ('target_modules', models.JSONField(blank=True, default=list)),
                ('target_emails', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='WorkspaceNotificationRead',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('read_at', models.DateTimeField(auto_now_add=True)),
                ('notification', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='read_receipts', to='authentication.workspacenotification')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notification_reads', to='authentication.userprofile')),
            ],
        ),
        migrations.AddConstraint(
            model_name='workspacenotificationread',
            constraint=models.UniqueConstraint(fields=('notification', 'user'), name='unique_workspace_notification_read'),
        ),
    ]
