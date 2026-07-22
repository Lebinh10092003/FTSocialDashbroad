from datetime import datetime, timedelta

from django.db import migrations


TOKEN_LIFETIME_DAYS = 53


def _expiry_from_issued_at(value):
    try:
        issued_at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return issued_at, (issued_at + timedelta(days=TOKEN_LIFETIME_DAYS)).isoformat()


def normalize_scan_token_ttl(apps, schema_editor):
    SystemConfig = apps.get_model("authentication", "SystemConfig")
    config = SystemConfig.objects.filter(key="main").first()
    if not config or not isinstance(config.data, dict):
        return

    data = dict(config.data)
    scan_tokens = [item for item in data.get("facebookScanTokens", []) if isinstance(item, dict)]
    expiry_by_source_id = {}
    changed = False

    for token in scan_tokens:
        dates = _expiry_from_issued_at(token.get("issuedAt"))
        if not dates:
            continue
        issued_at, expires_at = dates
        if token.get("expiresAt") != expires_at:
            token["expiresAt"] = expires_at
            changed = True
        token_id = str(token.get("id") or "")
        if token_id:
            expiry_by_source_id[token_id] = (issued_at, expires_at)

    rows = [item for item in data.get("detailedTokensList", []) if isinstance(item, dict)]
    for row in rows:
        dates = expiry_by_source_id.get(str(row.get("sourceTokenId") or ""))
        if not dates:
            continue
        issued_at, expires_at = dates
        if row.get("issuedAt") != issued_at or row.get("expiresAt") != expires_at:
            row["issuedAt"] = issued_at
            row["expiresAt"] = expires_at
            changed = True

    if changed:
        data["facebookScanTokens"] = scan_tokens
        data["detailedTokensList"] = rows
        config.data = data
        config.save(update_fields=["data"])


class Migration(migrations.Migration):
    dependencies = [("authentication", "0002_provision_phong_admin")]
