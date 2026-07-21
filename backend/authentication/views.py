import base64
import binascii
import json
import os
import re
import urllib.parse
import uuid
from pathlib import Path

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from integrations.google_sheets import (
    build_sheets_service,
    extract_spreadsheet_id,
    initialize_sheets_structure,
)
from .auth import get_admin_emails
from .models import SystemConfig, UserLogin, UserProfile
from .permissions import IsAdmin, IsAuthenticated, IsManagerOrAdmin

User = get_user_model()
VALID_ROLES = {"ADMIN", "MANAGER", "EMPLOYEE"}
SENSITIVE_CONFIG_KEYS = {
    "metaPageTokensJson",
    "zaloOaTokensJson",
    "detailedTokensList",
    "cronSecret",
    "googleServiceAccountJson",
    "lastGoogleAccessToken",
    "lastGoogleAccessTokenTime",
}


def _normalise_email(value: str) -> str:
    email = str(value or "").strip().lower()
    if email and "@" not in email:
        email = f"{email}@ftsocial.com"
    return email


def _client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()[:50]
    return str(request.META.get("REMOTE_ADDR", ""))[:50]


def _user_payload(profile: UserProfile) -> dict:
    return {
        "uid": profile.email,
        "email": profile.email,
        "name": profile.name or profile.email.split("@", 1)[0],
        "displayName": profile.name or profile.email.split("@", 1)[0],
        "picture": profile.photo_url or "",
        "photoURL": profile.photo_url or "",
        "role": profile.role,
        "lastLogin": profile.last_login.isoformat() if profile.last_login else None,
        "updatedAt": profile.updated_at.isoformat(),
    }


def _record_login(request, profile: UserProfile) -> None:
    now = timezone.now()
    UserLogin.objects.create(
        id=f"login_{int(now.timestamp() * 1000)}_{uuid.uuid4().hex[:8]}",
        email=profile.email,
        name=profile.name or "",
        role=profile.role,
        login_at=now,
        user_agent=str(request.META.get("HTTP_USER_AGENT", ""))[:5000],
        ip=_client_ip(request),
    )


def _profile_for_user(django_user) -> UserProfile:
    email = _normalise_email(django_user.email or django_user.username)
    profile, _ = UserProfile.objects.get_or_create(
        email=email,
        defaults={
            "name": django_user.get_full_name() or django_user.username,
            "role": "EMPLOYEE",
        },
    )
    role = profile.role if profile.role in VALID_ROLES else "EMPLOYEE"
    if django_user.is_superuser or email in get_admin_emails():
        role = "ADMIN"
    profile.role = role
    profile.name = profile.name or django_user.get_full_name() or django_user.username
    profile.save()
    return profile


def _bootstrap_admin(email: str, password: str):
    configured_email = _normalise_email(
        os.getenv("BOOTSTRAP_ADMIN_EMAIL", "")
        or next(iter(get_admin_emails()), "")
    )
    configured_password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not configured_email or not configured_password:
        return None
    if User.objects.exists() or email != configured_email or password != configured_password:
        return None
    return User.objects.create_superuser(
        username=configured_email,
        email=configured_email,
        password=configured_password,
    )


def _seed_config() -> dict:
    return {
        "metaPageTokensJson": os.getenv("META_PAGE_TOKENS_JSON", "{}"),
        "zaloOaTokensJson": os.getenv("ZALO_OA_TOKENS_JSON", "{}"),
        "detailedTokensList": [],
        "cronSecret": os.getenv("CRON_SECRET", ""),
        "adminEmails": os.getenv("ADMIN_EMAILS", ""),
        "spreadsheetId": "",
        "googleServiceAccountJson": os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", ""),
        "autoSyncEnabled": True,
        "updatedAt": timezone.now().isoformat(),
    }


def _get_config() -> SystemConfig:
    config, created = SystemConfig.objects.get_or_create(key="main")
    if created or not config.data:
        config.data = _seed_config()
        config.admin_emails = config.data.get("adminEmails") or ""
        config.save()
    return config


def _sync_channels(tokens: list[dict]) -> None:
    from social.models import Channel

    now = timezone.now()
    active_pairs: set[tuple[str, str]] = set()
    for token in tokens:
        platform = str(token.get("platform") or "").strip().lower()
        page_id = str(token.get("pageId") or "").strip()
        if platform not in {"facebook", "zalo", "mock"} or not page_id:
            continue
        active_pairs.add((platform, page_id))
        name = str(token.get("pageName") or "").strip() or f"{platform} {page_id}"
        channel = Channel.objects.filter(platform=platform, external_id=page_id).first()
        if channel:
            channel.name = name
            channel.status = "active"
            channel.updated_at = now
            channel.save(update_fields=["name", "status", "updated_at"])
        else:
            Channel.objects.create(
                id=str(uuid.uuid4()),
                platform=platform,
                name=name,
                external_id=page_id,
                status="active",
                timezone="Asia/Ho_Chi_Minh",
                created_at=now,
                updated_at=now,
            )

    for channel in Channel.objects.filter(status="active"):
        if (channel.platform, channel.external_id) not in active_pairs:
            channel.status = "inactive"
            channel.updated_at = now
            channel.save(update_fields=["status", "updated_at"])


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "backend": "django", "time": timezone.now().isoformat()})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    email = _normalise_email(request.data.get("email") or request.data.get("username"))
    password = str(request.data.get("password") or "")
    if not email or not password:
        return Response({"error": "Vui lòng nhập email và mật khẩu."}, status=status.HTTP_400_BAD_REQUEST)

    django_user = authenticate(request=request, username=email, password=password)
    if django_user is None:
        django_user = _bootstrap_admin(email, password)
    if django_user is None:
        return Response({"error": "Tên đăng nhập hoặc mật khẩu không chính xác."}, status=status.HTTP_401_UNAUTHORIZED)
    if not django_user.is_active:
        return Response({"error": "Tài khoản đã bị khóa."}, status=status.HTTP_403_FORBIDDEN)

    profile = _profile_for_user(django_user)
    profile.last_login = timezone.now()
    profile.save(update_fields=["last_login", "updated_at"])
    _record_login(request, profile)

    Token.objects.filter(user=django_user).delete()
    token = Token.objects.create(user=django_user)
    return Response({"token": token.key, "user": _user_payload(profile)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    if request.auth:
        request.auth.delete()
    return Response({"success": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    profile = request.user
    profile.last_login = timezone.now()
    profile.save(update_fields=["last_login", "updated_at"])
    return Response(_user_payload(profile))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def auth_sync(request):
    profile = request.user
    name = str(request.data.get("displayName") or request.data.get("name") or "").strip()
    if name:
        profile.name = name
    profile.last_login = timezone.now()
    profile.save()
    _record_login(request, profile)
    return Response({"success": True, "user": _user_payload(profile)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_profile(request):
    profile = request.user
    display_name = str(request.data.get("displayName") or request.data.get("name") or "").strip()
    photo_url = str(request.data.get("photoURL") or request.data.get("photo_url") or "").strip()
    if display_name:
        profile.name = display_name
    if photo_url:
        profile.photo_url = photo_url
    profile.save()
    return Response(_user_payload(profile))


@api_view(["GET", "POST"])
@permission_classes([IsManagerOrAdmin])
def manage_users(request):
    if request.method == "GET":
        users = UserProfile.objects.all().order_by("-updated_at")
        return Response([_user_payload(item) for item in users])
    return admin_create_user(request)


@api_view(["PUT", "DELETE"])
@permission_classes([IsAdmin])
def manage_single_user(request, email):
    clean_email = _normalise_email(email)
    profile = UserProfile.objects.filter(email=clean_email).first()
    if not profile:
        return Response({"error": "Không tìm thấy người dùng."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        return _delete_account(clean_email)

    role = str(request.data.get("role") or "").upper()
    if role not in {"MANAGER", "EMPLOYEE"}:
        return Response({"error": "Vai trò chỉ có thể là MANAGER hoặc EMPLOYEE."}, status=status.HTTP_400_BAD_REQUEST)
    profile.role = role
    profile.save(update_fields=["role", "updated_at"])
    return Response(_user_payload(profile))


@api_view(["GET"])
@permission_classes([IsManagerOrAdmin])
def admin_users(request):
    users = UserProfile.objects.all().order_by("-updated_at")
    return Response([_user_payload(item) for item in users])


@api_view(["POST"])
@permission_classes([IsManagerOrAdmin])
def admin_create_user(request):
    email = _normalise_email(request.data.get("email"))
    password = str(request.data.get("password") or "")
    name = str(request.data.get("name") or "").strip() or email.split("@", 1)[0]
    role = str(request.data.get("role") or "EMPLOYEE").upper()

    if not email or not password:
        return Response({"error": "Vui lòng nhập email và mật khẩu."}, status=status.HTTP_400_BAD_REQUEST)
    if role not in {"MANAGER", "EMPLOYEE"}:
        return Response({"error": "Chỉ được cấp vai trò Quản lý hoặc Nhân viên."}, status=status.HTTP_400_BAD_REQUEST)
    if request.user_role == "MANAGER" and role != "EMPLOYEE":
        return Response({"error": "Quản lý chỉ được tạo tài khoản Nhân viên."}, status=status.HTTP_403_FORBIDDEN)
    try:
        validate_password(password)
    except ValidationError as exc:
        return Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        django_user = User.objects.filter(username=email).first()
        created = django_user is None
        if created:
            django_user = User.objects.create_user(username=email, email=email, password=password)
        else:
            if django_user.is_superuser:
                return Response({"error": "Không thể thay đổi tài khoản quản trị hệ thống."}, status=status.HTTP_400_BAD_REQUEST)
            django_user.email = email
            django_user.set_password(password)
        django_user.first_name = name
        django_user.is_active = True
        django_user.save()
        Token.objects.filter(user=django_user).delete()
        profile, _ = UserProfile.objects.update_or_create(
            email=email,
            defaults={"name": name, "role": role},
        )

    return Response({
        "success": True,
        "message": "Tạo tài khoản thành công." if created else "Cập nhật tài khoản thành công.",
        "user": _user_payload(profile),
    })


def _delete_account(email: str) -> Response:
    django_user = User.objects.filter(username=email).first()
    profile = UserProfile.objects.filter(email=email).first()
    if (django_user and django_user.is_superuser) or (profile and profile.role == "ADMIN") or email in get_admin_emails():
        return Response({"error": "Không được phép xóa tài khoản Admin."}, status=status.HTTP_400_BAD_REQUEST)
    if django_user:
        django_user.delete()
    if profile:
        profile.delete()
    return Response({"success": True, "message": f"Đã xóa tài khoản {email}."})


@api_view(["POST"])
@permission_classes([IsManagerOrAdmin])
def admin_delete_user(request):
    email = _normalise_email(request.data.get("email"))
    if not email:
        return Response({"error": "Thiếu email cần xóa."}, status=status.HTTP_400_BAD_REQUEST)
    target = UserProfile.objects.filter(email=email).first()
    if request.user_role == "MANAGER" and (not target or target.role != "EMPLOYEE"):
        return Response({"error": "Quản lý chỉ được xóa tài khoản Nhân viên."}, status=status.HTTP_403_FORBIDDEN)
    return _delete_account(email)


@api_view(["GET"])
@permission_classes([IsAdmin])
def list_logins(request):
    rows = UserLogin.objects.all().order_by("-login_at")[:200]
    return Response([
        {
            "id": row.id,
            "email": row.email,
            "name": row.name,
            "role": row.role,
            "loginAt": row.login_at.isoformat(),
            "userAgent": row.user_agent,
            "ip": row.ip,
        }
        for row in rows
    ])


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def system_config_view(request):
    config = _get_config()
    if request.method == "GET":
        data = dict(config.data or {})
        if request.user_role != "ADMIN":
            for key in SENSITIVE_CONFIG_KEYS:
                data.pop(key, None)
        return Response(data)

    if request.user_role != "ADMIN":
        return Response({"error": "Quyền truy cập bị từ chối."}, status=status.HTTP_403_FORBIDDEN)
    payload = dict(request.data or {})
    current = dict(config.data or {})
    current.update(payload)
    current["updatedAt"] = timezone.now().isoformat()
    config.data = current
    if "adminEmails" in payload:
        config.admin_emails = str(payload.get("adminEmails") or "")
    config.save()
    if isinstance(payload.get("detailedTokensList"), list):
        _sync_channels(payload["detailedTokensList"])
    return Response({"success": True, "message": "Đã lưu cấu hình hệ thống."})


@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def admin_config(request):
    return system_config_view(request)


@api_view(["POST"])
@permission_classes([IsAdmin])
def setup_sheets(request):
    source = str(request.data.get("spreadsheetId") or "").strip()
    spreadsheet_id = extract_spreadsheet_id(source)
    if not spreadsheet_id:
        return Response({"error": "Spreadsheet ID hoặc URL không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    config = _get_config()
    try:
        service = build_sheets_service(request.google_access_token, config.data or {})
        result = initialize_sheets_structure(service, spreadsheet_id)
    except Exception as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    config.data = {**(config.data or {}), "spreadsheetId": spreadsheet_id, "updatedAt": timezone.now().isoformat()}
    config.save(update_fields=["data"])
    return Response(result)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_image(request):
    try:
        filename = "image"
        mime_type = ""
        file_bytes = b""
        content_type = (request.content_type or "").split(";", 1)[0].strip().lower()

        if content_type in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
            filename = urllib.parse.unquote(request.headers.get("X-File-Name", "image"))
            mime_type = content_type
            file_bytes = request.body
        else:
            data = request.data or {}
            filename = str(data.get("filename") or "image")
            encoded = str(data.get("base64") or "")
            if "," in encoded:
                header, encoded = encoded.split(",", 1)
                if "image/" in header:
                    mime_type = header.split(";", 1)[0].split(":", 1)[1]
            else:
                mime_type = "image/png"
            if encoded:
                try:
                    file_bytes = base64.b64decode(encoded, validate=True)
                except (binascii.Error, ValueError):
                    return Response({"error": "Dữ liệu base64 không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

        if not file_bytes:
            return Response({"error": "Không nhận diện được tệp hình ảnh."}, status=status.HTTP_400_BAD_REQUEST)
        if len(file_bytes) > settings.MAX_UPLOAD_SIZE:
            return Response({"error": "Ảnh vượt quá giới hạn dung lượng."}, status=status.HTTP_400_BAD_REQUEST)

        signatures = {
            "image/jpeg": (lambda value: value.startswith(b"\xff\xd8\xff"), ".jpg"),
            "image/png": (lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"), ".png"),
            "image/gif": (lambda value: value.startswith((b"GIF87a", b"GIF89a")), ".gif"),
            "image/webp": (lambda value: len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WEBP", ".webp"),
        }
        validator = signatures.get(mime_type)
        if not validator or not validator[0](file_bytes):
            return Response({"error": "Định dạng ảnh không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(filename).stem)[:80] or "image"
        unique_filename = f"{safe_name}_{uuid.uuid4().hex[:12]}{validator[1]}"
        settings.MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        (settings.MEDIA_ROOT / unique_filename).write_bytes(file_bytes)
        return Response({"success": True, "url": f"{settings.MEDIA_URL}{unique_filename}"})
    except Exception as exc:
        return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
