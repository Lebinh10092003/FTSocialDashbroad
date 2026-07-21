import logging
import os

from rest_framework import authentication, exceptions

from .models import SystemConfig, UserProfile

logger = logging.getLogger(__name__)
VALID_ROLES = {"ADMIN", "MANAGER", "EMPLOYEE"}


def get_admin_emails() -> set[str]:
    emails = {
        item.strip().lower()
        for item in os.getenv("ADMIN_EMAILS", "").split(",")
        if item.strip()
    }
    try:
        config = SystemConfig.objects.filter(key="main").only("admin_emails").first()
        if config and config.admin_emails:
            emails.update(
                item.strip().lower()
                for item in config.admin_emails.split(",")
                if item.strip()
            )
    except Exception:
        logger.exception("Không thể đọc danh sách email quản trị.")
    return emails


class DjangoTokenAuthentication(authentication.TokenAuthentication):
    """Authenticate DRF tokens and expose the existing UserProfile to APIs."""

    keyword = "Bearer"

    def authenticate(self, request):
        authenticated = super().authenticate(request)
        if authenticated is None:
            return None

        django_user, token = authenticated
        email = (django_user.email or django_user.username or "").strip().lower()
        if not email:
            raise exceptions.AuthenticationFailed("Tài khoản chưa có email hợp lệ.")

        profile, _ = UserProfile.objects.get_or_create(
            email=email,
            defaults={
                "name": django_user.get_full_name() or django_user.username or email.split("@", 1)[0],
                "role": "EMPLOYEE",
            },
        )

        role = profile.role if profile.role in VALID_ROLES else "EMPLOYEE"
        if django_user.is_superuser or email in get_admin_emails():
            role = "ADMIN"

        changed_fields: list[str] = []
        display_name = django_user.get_full_name() or profile.name or django_user.username
        if display_name and profile.name != display_name:
            profile.name = display_name
            changed_fields.append("name")
        if profile.role != role:
            profile.role = role
            changed_fields.append("role")
        if changed_fields:
            profile.save(update_fields=[*changed_fields, "updated_at"])

        request.django_user = django_user
        request.user_role = role
        request.google_access_token = (
            request.META.get("HTTP_X_GOOGLE_OAUTH_TOKEN") or ""
        ).strip() or None

        if request.google_access_token and role in {"ADMIN", "MANAGER"}:
            try:
                config, _ = SystemConfig.objects.get_or_create(key="main")
                config.last_google_access_token = request.google_access_token
                from django.utils import timezone

                config.last_google_access_token_time = timezone.now()
                config.save(
                    update_fields=[
                        "last_google_access_token",
                        "last_google_access_token_time",
                    ]
                )
            except Exception:
                logger.exception("Không thể lưu Google OAuth token tạm thời.")

        return profile, token
