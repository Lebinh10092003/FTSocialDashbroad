import re
import unicodedata
from datetime import datetime, timedelta

from django.utils import timezone

from .models import SystemConfig, UserProfile, WorkspaceNotification
from .notifications import notify_workspace


CONFIG_KEY = "monthly_sheet_links"
MODULES = {
    "attendance": {"label": "Công ca", "action_url": "/attendance"},
    "work_schedule": {"label": "Lịch làm việc", "action_url": "/work-schedule/sheets"},
}
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
SHEET_URL_PATTERN = re.compile(
    r"^https://(?:docs\.google\.com/spreadsheets/d/|drive\.google\.com/file/d/)[A-Za-z0-9_-]+",
    re.IGNORECASE,
)


def normalize_label(value):
    text = unicodedata.normalize("NFD", str(value or "").strip().casefold().replace("đ", "d"))
    return " ".join("".join(char for char in text if unicodedata.category(char) != "Mn").split())


def valid_month(value):
    return bool(MONTH_PATTERN.fullmatch(str(value or "")))


def valid_sheet_url(value):
    return not value or bool(SHEET_URL_PATTERN.match(str(value).strip()))


def get_monthly_sheet_links(month):
    config, _ = SystemConfig.objects.get_or_create(key=CONFIG_KEY, defaults={"data": {"links": {}}})
    data = config.data if isinstance(config.data, dict) else {}
    links = data.get("links") if isinstance(data.get("links"), dict) else {}
    return {
        module: str((links.get(module) or {}).get(month) or "").strip()
        for module in MODULES
    }


def set_monthly_sheet_link(module, month, url, actor_email=""):
    config, _ = SystemConfig.objects.get_or_create(key=CONFIG_KEY, defaults={"data": {"links": {}}})
    data = dict(config.data) if isinstance(config.data, dict) else {}
    links = dict(data.get("links")) if isinstance(data.get("links"), dict) else {}
    module_links = dict(links.get(module)) if isinstance(links.get(module), dict) else {}
    if url:
        module_links[month] = url
    else:
        module_links.pop(month, None)
    links[module] = module_links
    data.update({"links": links, "updatedAt": timezone.now().isoformat(), "updatedBy": actor_email})
    config.data = data
    config.save(update_fields=["data"])
    if url:
        WorkspaceNotification.objects.filter(event_key=f"monthly-sheet-link-missing:{module}:{month}").delete()
    return get_monthly_sheet_links(month)


def accounting_emails():
    profiles = UserProfile.objects.filter(employment_status="ACTIVE").select_related("department", "job_title").prefetch_related("departments")
    result = []
    for profile in profiles:
        labels = [profile.job_title.name if profile.job_title else "", profile.department.name if profile.department else ""]
        labels.extend(department.name for department in profile.departments.all())
        if any("ke toan" in normalize_label(label) or "accounting" in normalize_label(label) for label in labels):
            result.append(profile.email)
    return sorted(set(result))


def remind_missing_monthly_sheet_links(month=None, now=None):
    now = now or timezone.now()
    month = month or timezone.localtime(now).strftime("%Y-%m")
    if not valid_month(month):
        raise ValueError("Tháng không hợp lệ; dùng định dạng YYYY-MM.")
    links = get_monthly_sheet_links(month)
    recipients = accounting_emails()
    created = []
    month_label = datetime.strptime(month, "%Y-%m").strftime("%m/%Y")
    for module, settings in MODULES.items():
        if links[module]:
            continue
        notification, was_created = notify_workspace(
            event_key=f"monthly-sheet-link-missing:{module}:{month}",
            title=f"Cần cập nhật link {settings['label']} tháng {month_label}",
            message=f"Link trang tính {settings['label']} tháng {month_label} chưa được cấu hình. Vui lòng phối hợp Admin cập nhật link để hệ thống sử dụng đúng dữ liệu tháng này.",
            severity="warning",
            category="monthly-sheet-link",
            action_url=settings["action_url"],
            target_roles=["ADMIN"],
            target_emails=recipients,
            expires_at=(now + timedelta(days=40)),
        )
        if was_created:
            created.append(notification.id)
    return {"month": month, "missing": [module for module, url in links.items() if not url], "created": created, "recipients": recipients}
