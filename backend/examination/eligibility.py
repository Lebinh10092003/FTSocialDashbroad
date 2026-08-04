import re
import unicodedata

ELIGIBILITY_ELIGIBLE = 'Đủ điều kiện'
ELIGIBILITY_INELIGIBLE = 'Không đủ điều kiện'


def normalize_eligibility(value, default=ELIGIBILITY_ELIGIBLE):
    """Collapse imported and manually entered eligibility into the two supported states."""
    raw = str(value or '').strip()
    if not raw:
        return default
    normalized = unicodedata.normalize('NFD', raw.casefold().replace('đ', 'd'))
    normalized = ''.join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r'[^a-z0-9]+', '', normalized)
    if 'khongdudieukien' in normalized or 'chuadudieukien' in normalized:
        return ELIGIBILITY_INELIGIBLE
    return ELIGIBILITY_ELIGIBLE