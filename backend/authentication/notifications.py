from django.utils import timezone

from .models import WorkspaceNotification


def notify_workspace(*, event_key, title, message, severity='info', category='workspace',
                     action_url='', target_roles=None, target_modules=None, target_emails=None,
                     expires_at=None):
    """Create an idempotent notification so scheduled jobs can safely retry."""
    notification, created = WorkspaceNotification.objects.get_or_create(
        event_key=str(event_key)[:255],
        defaults={
            'title': str(title)[:255],
            'message': str(message),
            'severity': severity,
            'category': str(category)[:80],
            'action_url': str(action_url)[:1000],
            'target_roles': list(target_roles or []),
            'target_modules': list(target_modules or []),
            'target_emails': [str(value).strip().lower() for value in (target_emails or []) if str(value).strip()],
            'expires_at': expires_at,
        },
    )
    return notification, created


def notification_visible_to(notification, profile):
    if notification.expires_at and notification.expires_at <= timezone.now():
        return False
    if str(profile.role).upper() == 'ADMIN':
        return True
    email = str(profile.email).strip().lower()
    if email in {str(value).strip().lower() for value in (notification.target_emails or [])}:
        return True
    roles = {str(value).upper() for value in (notification.target_roles or [])}
    if roles and str(profile.role).upper() in roles:
        return True
    modules = set(profile.access_modules or [])
    targets = set(notification.target_modules or [])
    return bool(targets and modules.intersection(targets))
