from calendar import monthrange

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


def sync_partner_product_subscriptions(partner):
    source = " | ".join(str(value or "").strip().casefold() for value in partner.products or [])
    codes = []
    if "bndc" in source or "không gian dữ liệu dùng chung" in source:
        codes.append("bndc")
    if "ai dùng chung" in source or "ai có bản quyền dùng chung" in source or partner.ai_account_count:
        codes.append("ai-dung-chung")
    if "lớp học số" in source or "trường học số" in source:
        codes.append("lop-hoc-so")
    products = {item.code: item for item in TrainingProduct.objects.filter(code__in=codes)}
    for code in codes:
        product = products.get(code)
        if not product:
            continue
        TrainingProductSubscription.objects.get_or_create(
            partner=partner,
            product=product,
            defaults={
                "quantity": partner.ai_account_count if code == "ai-dung-chung" and partner.ai_account_count else 1,
                "starts_at": partner.contract_signed_date,
                "expires_at": _contract_expiry(partner),
                "status": "active",
                "notes": "Tự động nhập từ hồ sơ khách hàng.",
            },
        )
