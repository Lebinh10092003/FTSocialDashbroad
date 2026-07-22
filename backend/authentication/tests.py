from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from social.models import Channel
from .models import SystemConfig
from .views import SENSITIVE_CONFIG_KEYS, _get_config, _normalise_token_rows, _sync_channels


class TokenLifecycleTests(TestCase):
    def test_pages_inherit_their_source_token_expiry_independently(self):
        now = timezone.now()
        scans = [
            {
                "id": "scan-a",
                "accessToken": "scan-secret-a",
                "issuedAt": now.isoformat(),
                "expiresAt": (now + timedelta(days=54)).isoformat(),
                "pageIds": ["page-a"],
            },
            {
                "id": "scan-b",
                "accessToken": "scan-secret-b",
                "issuedAt": now.isoformat(),
                "expiresAt": (now + timedelta(days=31)).isoformat(),
                "pageIds": ["page-b"],
            },
        ]
        rows = [
            {"id": "facebook-page-a", "platform": "facebook", "pageId": "page-a", "pageName": "Page A", "accessToken": "page-secret-a"},
            {"id": "facebook-page-b", "platform": "facebook", "pageId": "page-b", "pageName": "Page B", "accessToken": "page-secret-b"},
        ]

        normalised = _normalise_token_rows(rows, [], now, scans)

        self.assertEqual(normalised[0]["sourceTokenId"], "scan-a")
        self.assertEqual(normalised[0]["expiresAt"], scans[0]["expiresAt"])
        self.assertEqual(normalised[1]["sourceTokenId"], "scan-b")
        self.assertEqual(normalised[1]["expiresAt"], scans[1]["expiresAt"])

    def test_existing_placeholder_is_migrated_without_becoming_a_channel(self):
        now = timezone.now()
        scan_expiry = (now + timedelta(days=54)).isoformat()
        page_expiry = (now + timedelta(days=60)).isoformat()
        scan = {
            "id": "facebook-scan-current",
            "platform": "facebook",
            "label": "Token quet Facebook",
            "accessToken": "scan-secret",
            "issuedAt": now.isoformat(),
            "expiresAt": scan_expiry,
            "pageIds": ["real-page"],
            "pageNames": ["Real Page"],
        }
        SystemConfig.objects.create(
            key="main",
            data={
                "detailedTokensList": [
                    {"id": "facebook-current-token", "platform": "facebook", "pageId": "current-facebook-token", "pageName": "Facebook", "accessToken": "scan-secret", "issuedAt": now.isoformat(), "expiresAt": scan_expiry},
                    {"id": "facebook-real-page", "platform": "facebook", "pageId": "real-page", "pageName": "Real Page", "accessToken": "page-secret", "issuedAt": now.isoformat(), "expiresAt": page_expiry},
                ],
                "facebookScanTokens": [scan],
            },
        )

        config = _get_config()
        rows = config.data["detailedTokensList"]

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["pageId"], "real-page")
        self.assertEqual(rows[0]["expiresAt"], scan_expiry)
        self.assertEqual(rows[0]["sourceTokenId"], "facebook-scan-current")
        _sync_channels(config.data["detailedTokensList"])
        self.assertFalse(Channel.objects.filter(external_id="current-facebook-token").exists())
        self.assertTrue(Channel.objects.filter(external_id="real-page", status="active").exists())

    def test_scan_tokens_are_hidden_from_non_admin_config_payloads(self):
        self.assertIn("facebookScanTokens", SENSITIVE_CONFIG_KEYS)
