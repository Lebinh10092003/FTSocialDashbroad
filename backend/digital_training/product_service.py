from calendar import monthrange
import unicodedata

from .models import TrainingProduct, TrainingProductSubscription


def _contract_expiry(partner):
    start = partner.contract_signed_date
    amount = partner.contract_duration
    if not start or not amount:
        return None
    if partner.contract_duration_unit == "year":
        year = start.year + amount
        return start.replace(year=year, day=min(start.day, monthrange(year, start.month)[1]))
    month_index = start.month - 1 + amount
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    return start.replace(year=year, month=month, day=min(start.day, monthrange(year, month)[1]))


def _normalise_product_name(value):
    text = unicodedata.normalize("NFD", str(value or "").casefold())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return text.replace("đ", "d").strip()


def sync_partner_product_subscriptions(partner):
    selected = {
        _normalise_product_name(value)
        for value in (partner.products or [])
        if str(value or "").strip()
    }
    if not selected:
        return

    legacy_aliases = {
        "bndc": {"bndc", "khong gian du lieu dung chung"},
        "ai-dung-chung": {"ai dung chung", "ai co ban quyen dung chung"},
        "lop-hoc-so": {"lop hoc so", "truong hoc so", "lop hoc so/truong hoc so"},
    }

    for product in TrainingProduct.objects.filter(active=True):
        code = product.code.casefold()
        matches_catalog_product = {
            _normalise_product_name(product.name),
            _normalise_product_name(code),
        } & selected
        matches_legacy_product = legacy_aliases.get(code, set()) & selected
        if not matches_catalog_product and not matches_legacy_product and not (
            code == "ai-dung-chung" and partner.ai_account_count
        ):
            continue
        TrainingProductSubscription.objects.get_or_create(
            partner=partner,
            product=product,
            defaults={
                "quantity": partner.ai_account_count if product.code == "ai-dung-chung" and partner.ai_account_count else 1,
                "starts_at": partner.contract_signed_date,
                "expires_at": _contract_expiry(partner),
                "status": "active",
                "notes": "Imported from customer profile.",
            },
        )
