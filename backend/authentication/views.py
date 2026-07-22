import base64
import binascii
import json
import os
import re
import urllib.parse
import uuid
from datetime import timedelta
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
    "facebookScanTokens",
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
    if email != configured_email or password != configured_password:
        return None
    django_user, created = User.objects.get_or_create(
        username=configured_email,
        defaults={"email": configured_email, "is_staff": True, "is_superuser": True, "is_active": True},
    )
    if created or not django_user.check_password(configured_password):
        django_user.set_password(configured_password)
    django_user.email = configured_email
    django_user.is_staff = True
    django_user.is_superuser = True
    django_user.is_active = True
    django_user.save()
    return django_user



TOKEN_LIFETIME_DAYS = 60
TOKEN_WARNING_DAYS = 5


def _token_dates(previous: dict | None, access_token: str, now) -> tuple[str, str]:
    if previous and str(previous.get("accessToken") or "") == access_token:
        issued_at = str(previous.get("issuedAt") or "").strip()
        expires_at = str(previous.get("expiresAt") or "").strip()
        if issued_at and expires_at:
            return issued_at, expires_at
    return now.isoformat(), (now + timedelta(days=TOKEN_LIFETIME_DAYS)).isoformat()


def _is_placeholder_token(item: dict) -> bool:
    return (
        str(item.get("id") or "").strip() == "facebook-current-token"
        or str(item.get("pageId") or "").strip() == "current-facebook-token"
    )


def _normalise_token_rows(rows, previous_rows, now, scan_tokens=None):
    previous_by_id = {
        str(item.get("id") or ""): item
        for item in previous_rows if isinstance(item, dict) and item.get("id")
    }
    scan_tokens = [item for item in (scan_tokens or []) if isinstance(item, dict)]
    scans_by_id = {str(item.get("id") or ""): item for item in scan_tokens}
    normalised = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        if _is_placeholder_token(item):
            continue
        token_id = str(item.get("id") or "").strip()
        platform = str(item.get("platform") or "").strip().lower()
        page_id = str(item.get("pageId") or "").strip()
        access_token = str(item.get("accessToken") or "").strip()
        if not token_id or platform not in {"facebook", "zalo", "mock"} or not page_id or not access_token:
            continue

        source_token = scans_by_id.get(str(item.get("sourceTokenId") or ""))
        if source_token is None:
            matching_scans = [
                scan for scan in scan_tokens
                if page_id in [str(value) for value in scan.get("pageIds", [])]
            ]
            if matching_scans:
                source_token = max(matching_scans, key=lambda scan: str(scan.get("issuedAt") or ""))
        if source_token and source_token.get("issuedAt") and source_token.get("expiresAt"):
            issued_at = str(source_token["issuedAt"])
            expires_at = str(source_token["expiresAt"])
            source_token_id = str(source_token.get("id") or "")
        else:
            issued_at, expires_at = _token_dates(previous_by_id.get(token_id), access_token, now)
            source_token_id = ""

        item.update({
            "id": token_id,
            "platform": platform,
            "pageId": page_id,
            "pageName": str(item.get("pageName") or "").strip() or f"{platform} {page_id}",
            "accessToken": access_token,
            "issuedAt": issued_at,
            "expiresAt": expires_at,
        })
        if source_token_id:
            item["sourceTokenId"] = source_token_id
        else:
            item.pop("sourceTokenId", None)
        normalised.append(item)
    return normalised


def _normalise_scan_tokens(rows, previous_rows, now):
    previous_by_id = {
        str(item.get("id") or ""): item
        for item in previous_rows if isinstance(item, dict) and item.get("id")
    }
    normalised = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        token_id = str(item.get("id") or "").strip()
        access_token = str(item.get("accessToken") or "").strip()
        if not token_id or not access_token:
            continue
        issued_at, expires_at = _token_dates(previous_by_id.get(token_id), access_token, now)
        page_names = [str(value).strip() for value in item.get("pageNames", []) if str(value).strip()]
        page_ids = [str(value).strip() for value in item.get("pageIds", []) if str(value).strip()]
        item.update({
            "id": token_id,
            "platform": "facebook",
            "label": str(item.get("label") or "Token quet Facebook").strip(),
            "accessToken": access_token,
            "issuedAt": issued_at,
            "expiresAt": expires_at,
            "pageIds": page_ids,
            "pageNames": page_names,
        })
        normalised.append(item)
    return normalised


def _days_remaining(expires_at: str, now) -> tuple[int, object] | None:
    try:
        parsed = timezone.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        days = max(0, int(max(0, (parsed - now).total_seconds() + 86399) // 86400))
        return days, parsed
    except (TypeError, ValueError):
        return None

def _seed_config() -> dict:
    now = timezone.now()
    scan_tokens = []
    current_facebook_token = os.getenv("CURRENT_FACEBOOK_ACCESS_TOKEN", "").strip()
    if current_facebook_token:
        try:
            ttl_days = max(1, int(os.getenv("CURRENT_FACEBOOK_TOKEN_TTL_DAYS", "54")))
        except ValueError:
            ttl_days = 54
        scan_tokens.append({
            "id": "facebook-scan-current",
            "platform": "facebook",
            "label": "Token quét Facebook",
            "accessToken": current_facebook_token,
            "issuedAt": now.isoformat(),
            "expiresAt": (now + timedelta(days=ttl_days)).isoformat(),
            "pageIds": [],
            "pageNames": [],
        })
    return {
        "metaPageTokensJson": os.getenv("META_PAGE_TOKENS_JSON", "{}"),
        "zaloOaTokensJson": os.getenv("ZALO_OA_TOKENS_JSON", "{}"),
        "detailedTokensList": [],
        "facebookScanTokens": scan_tokens,
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
    else:
        data = dict(config.data or {})
        rows = list(data.get("detailedTokensList") or [])
        raw_scan_tokens = list(data.get("facebookScanTokens") or [])
        now = timezone.now()
        scan_tokens = _normalise_scan_tokens(raw_scan_tokens, raw_scan_tokens, now)
        if not scan_tokens:
            scan_source = next(
                (item for item in rows if isinstance(item, dict) and _is_placeholder_token(item)),
                None,
            )
            if scan_source:
                facebook_pages = [
                    item for item in rows
                    if isinstance(item, dict)
                    and item.get("platform") == "facebook"
                    and not _is_placeholder_token(item)
                ]
                scan_tokens = _normalise_scan_tokens([{
                    "id": "facebook-scan-current",
                    "platform": "facebook",
                    "label": "Token quét Facebook",
                    "accessToken": scan_source.get("accessToken", ""),
                    "issuedAt": scan_source.get("issuedAt", ""),
                    "expiresAt": scan_source.get("expiresAt", ""),
                    "pageIds": [item.get("pageId", "") for item in facebook_pages],
                    "pageNames": [item.get("pageName", "") for item in facebook_pages],
                }], [], now)
        normalised_rows = _normalise_token_rows(rows, rows, now, scan_tokens)
        data["facebookScanTokens"] = scan_tokens
        if normalised_rows != rows or data != config.data:
            data["detailedTokensList"] = normalised_rows
            data["updatedAt"] = now.isoformat()
            config.data = data
            config.save(update_fields=["data"])
    return config


def _sync_channels(tokens: list[dict]) -> None:
    from social.models import Channel

    now = timezone.now()
    active_pairs: set[tuple[str, str]] = set()
    for token in tokens:
        platform = str(token.get("platform") or "").strip().lower()
        page_id = str(token.get("pageId") or "").strip()
        if platform not in {"facebook", "zalo", "mock"} or not page_id or _is_placeholder_token(token):
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
    return Response({"status": "ok"})


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
@permission_classes([IsManagerOrAdmin])
def manage_single_user(request, email):
    clean_email = _normalise_email(email)
    profile = UserProfile.objects.filter(email=clean_email).first()
    if not profile:
        return Response({"error": "Không tìm thấy người dùng."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        return _delete_account(clean_email)

    role = str(request.data.get("role") or "").upper()
    if role not in {"ADMIN", "MANAGER", "EMPLOYEE"}:
        return Response({"error": "Vai trò không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if request.user_role == "MANAGER" and role != "EMPLOYEE":
        return Response({"error": "Quản lý chỉ được cấp vai trò Nhân viên."}, status=status.HTTP_403_FORBIDDEN)
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
    if role not in {"ADMIN", "MANAGER", "EMPLOYEE"}:
        return Response({"error": "Vai trò không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
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


@api_view(["GET"])
@permission_classes([IsManagerOrAdmin])
def token_notifications(request):
    config = _get_config()
    now = timezone.now()
    notifications = []
    data = config.data or {}
    scan_tokens = [
        item for item in data.get("facebookScanTokens", []) if isinstance(item, dict)
    ]
    scan_token_ids = {str(item.get("id") or "") for item in scan_tokens}
    sources = [
        (item, [item.get("pageName") or item.get("pageId") or "Facebook"])
        for item in data.get("detailedTokensList", [])
        if isinstance(item, dict) and str(item.get("sourceTokenId") or "") not in scan_token_ids
    ]
    sources.extend(
        (item, item.get("pageNames") or item.get("pageIds") or [item.get("label") or "Facebook"])
        for item in scan_tokens
    )
    for item, affected_pages in sources:
        remaining = _days_remaining(str(item.get("expiresAt") or "").strip(), now)
        if not remaining:
            continue
        days_remaining, parsed_expiry = remaining
        if days_remaining <= TOKEN_WARNING_DAYS:
            notifications.append({
                "id": str(item.get("id") or ""),
                "platform": item.get("platform", "facebook"),
                "label": item.get("label") or item.get("pageName") or "Token Facebook",
                "affectedPages": [str(page) for page in affected_pages if str(page).strip()],
                "issuedAt": item.get("issuedAt") or "",
                "expiresAt": parsed_expiry.isoformat(),
                "daysRemaining": days_remaining,
            })
    return Response({"notifications": notifications, "warningDays": TOKEN_WARNING_DAYS})


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
    now = timezone.now()
    previous_rows = list(current.get("detailedTokensList") or [])
    previous_scan_tokens = list(current.get("facebookScanTokens") or [])
    current.update(payload)
    scan_source = payload.get("facebookScanTokens") if isinstance(payload.get("facebookScanTokens"), list) else previous_scan_tokens
    current["facebookScanTokens"] = _normalise_scan_tokens(scan_source, previous_scan_tokens, now)
    row_source = payload.get("detailedTokensList") if isinstance(payload.get("detailedTokensList"), list) else previous_rows
    current["detailedTokensList"] = _normalise_token_rows(
        row_source,
        previous_rows,
        now,
        current["facebookScanTokens"],
    )
    current["updatedAt"] = now.isoformat()
    config.data = current
    if "adminEmails" in payload:
        config.admin_emails = str(payload.get("adminEmails") or "")
    config.save()
    if isinstance(payload.get("detailedTokensList"), list):
        _sync_channels(current["detailedTokensList"])
    return Response({
        "success": True,
        "message": "Đã lưu cấu hình hệ thống.",
        "detailedTokensList": current.get("detailedTokensList", []),
        "facebookScanTokens": current.get("facebookScanTokens", []),
    })


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
