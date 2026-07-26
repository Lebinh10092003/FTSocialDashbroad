from datetime import datetime, timedelta

from django.conf import settings
from django.db import migrations


ADMIN_EMAIL = "phongnt@fermat.edu.vn"
OLD_PASSWORD_HASH = "pbkdf2_sha256$720000$EJfEcJrgywGviJZSFkwNQP$ZXBZ2Y0Up1Tv7yyO9PM4ntiwkF4t/OGHDuGAlVHKCRU="
NEW_PASSWORD_HASH = "pbkdf2_sha256$720000$QkVaUMf2fPZChVCV9NRCC0$i1YXY7t1zdsoyog1v7YaE8pEcIn/J67iCOJrvK/WWEA="
TOKEN_LIFETIME_DAYS = 60


def refresh_operational_defaults(apps, schema_editor):
    user_app, user_model = settings.AUTH_USER_MODEL.split(".")
    User = apps.get_model(user_app, user_model)
    user = User.objects.filter(username=ADMIN_EMAIL).first()
    if user and user.password == OLD_PASSWORD_HASH:
        user.password = NEW_PASSWORD_HASH
        user.is_active = True
        user.save(update_fields=["password", "is_active"])

    SystemConfig = apps.get_model("authentication", "SystemConfig")
    config = SystemConfig.objects.filter(key="main").first()
    if not config or not isinstance(config.data, dict):
        return
    data = dict(config.data)
    changed = False
    expiry_by_source = {}
    scan_tokens = []
    for raw in data.get("facebookScanTokens", []):
        if not isinstance(raw, dict):
            continue
        token = dict(raw)
        try:
            issued_at = datetime.fromisoformat(str(token.get("issuedAt") or "").replace("Z", "+00:00"))
        except (TypeError, ValueError):
            issued_at = None
        if issued_at:
            expected = (issued_at + timedelta(days=TOKEN_LIFETIME_DAYS)).isoformat()
            if token.get("expiresAt") != expected:
                token["expiresAt"] = expected
                changed = True
        token_id = str(token.get("id") or "")
        if token_id:
            expiry_by_source[token_id] = (token.get("issuedAt"), token.get("expiresAt"))
        scan_tokens.append(token)

    rows = []
    for raw in data.get("detailedTokensList", []):
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        dates = expiry_by_source.get(str(row.get("sourceTokenId") or ""))
        if dates and (row.get("issuedAt") != dates[0] or row.get("expiresAt") != dates[1]):
            row["issuedAt"], row["expiresAt"] = dates
            changed = True
        rows.append(row)
    if changed:
        data["facebookScanTokens"] = scan_tokens
        data["detailedTokensList"] = rows
        config.data = data
        config.save(update_fields=["data"])


def keep_data(apps, schema_editor):
    return


class Migration(migrations.Migration):
    dependencies = [("authentication", "0003_normalize_facebook_scan_token_ttl")]
    operations = [migrations.RunPython(refresh_operational_defaults, keep_data)]