import json
import logging
import os
from functools import lru_cache

import firebase_admin
from django.conf import settings
from django.utils import timezone
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials
from rest_framework import authentication, exceptions

from .models import SystemConfig, UserProfile

logger = logging.getLogger(__name__)
VALID_ROLES = {"ADMIN", "MANAGER", "EMPLOYEE"}


def _admin_emails() -> set[str]:
    configured: set[str] = set()
    try:
        config = SystemConfig.objects.filter(key="main").only("admin_emails").first()
        if config and config.admin_emails:
            configured.update(
                email.strip().lower()
                for email in config.admin_emails.split(",")
                if email.strip()
            )
    except Exception:
        logger.exception("Unable to read admin emails from the database.")

    configured.update(
        email.strip().lower()
        for email in os.getenv("ADMIN_EMAILS", "").split(",")
        if email.strip()
    )
    return configured


def _firebase_options() -> dict[str, str]:
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    return {"projectId": project_id} if project_id else {}


@lru_cache(maxsize=1)
def get_firebase_app():
    """Initialize Firebase Admin once, using a JSON credential when provided."""
    try:
        return firebase_admin.get_app()
    except ValueError:
        pass

    credential_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    options = _firebase_options()

    if credential_json:
        try:
            info = json.loads(credential_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.") from exc
        return firebase_admin.initialize_app(credentials.Certificate(info), options=options or None)

    # Token verification can work with Application Default Credentials when the
    # project ID is configured on the VPS. User-management APIs additionally
    # require a service account with Firebase Auth permissions.
    return firebase_admin.initialize_app(options=options or None)


def _verify_token(id_token: str) -> dict:
    if id_token.startswith("mock-dev-token-"):
        if not (settings.DEBUG and settings.ENABLE_MOCK_AUTH):
            raise exceptions.AuthenticationFailed("Mock authentication is disabled.")
        email = id_token.removeprefix("mock-dev-token-").strip().lower()
        if not email or "@" not in email:
            raise exceptions.AuthenticationFailed("Mock token email is invalid.")
        return {
            "uid": f"mock-uid-{email}",
            "email": email,
            "name": email.split("@", 1)[0],
            "picture": "",
        }

    try:
        return firebase_auth.verify_id_token(
            id_token,
            app=get_firebase_app(),
            check_revoked=False,
            clock_skew_seconds=5,
        )
    except Exception as exc:
        logger.warning("Firebase token verification failed: %s", exc)
        raise exceptions.AuthenticationFailed("ID Token is invalid or expired.") from exc


def _persist_google_token(token: str, role: str) -> None:
    if role not in {"ADMIN", "MANAGER"}:
        return
    try:
        config, _ = SystemConfig.objects.get_or_create(key="main")
        config.last_google_access_token = token
        config.last_google_access_token_time = timezone.now()
        config.save(
            update_fields=["last_google_access_token", "last_google_access_token_time"]
        )
    except Exception:
        logger.exception("Unable to persist the Google OAuth access token.")


class FirebaseTokenAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        auth_header = authentication.get_authorization_header(request).decode("utf-8")
        if not auth_header:
            return None

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != self.keyword.lower():
            raise exceptions.AuthenticationFailed("Authorization header must use Bearer token.")

        id_token = parts[1].strip()
        if not id_token:
            raise exceptions.AuthenticationFailed("ID Token is missing.")

        payload = _verify_token(id_token)
        email = str(payload.get("email") or "").strip().lower()
        if not email:
            raise exceptions.AuthenticationFailed("Verified token does not contain an email.")

        user_profile, created = UserProfile.objects.get_or_create(
            email=email,
            defaults={
                "name": payload.get("name") or email.split("@", 1)[0],
                "photo_url": payload.get("picture") or "",
                "role": "EMPLOYEE",
            },
        )

        is_admin = email in _admin_emails()
        stored_role = user_profile.role if user_profile.role in VALID_ROLES else "EMPLOYEE"
        role = "ADMIN" if is_admin else ("EMPLOYEE" if stored_role == "ADMIN" else stored_role)

        changed_fields: list[str] = []
        display_name = payload.get("name") or user_profile.name or email.split("@", 1)[0]
        picture = payload.get("picture") or user_profile.photo_url or ""
        if user_profile.name != display_name:
            user_profile.name = display_name
            changed_fields.append("name")
        if user_profile.photo_url != picture:
            user_profile.photo_url = picture
            changed_fields.append("photo_url")
        if user_profile.role != role:
            user_profile.role = role
            changed_fields.append("role")
        if changed_fields:
            user_profile.save(update_fields=[*changed_fields, "updated_at"])
        elif created:
            user_profile.save()

        google_token = str(request.META.get("HTTP_X_GOOGLE_OAUTH_TOKEN") or "").strip()
        if google_token:
            _persist_google_token(google_token, role)

        request.user_role = role
        request.auth_payload = payload
        request.google_access_token = google_token or None

        if request.google_access_token is None and role in {"ADMIN", "MANAGER"}:
            config = SystemConfig.objects.filter(key="main").only(
                "last_google_access_token"
            ).first()
            if config and config.last_google_access_token:
                request.google_access_token = config.last_google_access_token

        return user_profile, id_token
