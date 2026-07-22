from datetime import timedelta

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from django.utils import timezone

from social.models import Channel
from .models import SystemConfig, UserProfile
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

class AccountAdministrationTests(TestCase):
    def _token_for(self, email, role):
        user = get_user_model().objects.create_user(username=email, email=email, password="StrongPassword9921")
        UserProfile.objects.create(email=email, name=email.split("@", 1)[0], role=role)
        return Token.objects.create(user=user).key

    def test_admin_can_create_another_admin(self):
        token = self._token_for("owner@example.com", "ADMIN")

        response = self.client.post(
            "/api/admin/create-user",
            {"email": "second-admin@example.com", "name": "Second Admin", "password": "AnotherStrong9921", "role": "ADMIN"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        profile = UserProfile.objects.get(email="second-admin@example.com")
        self.assertEqual(profile.role, "ADMIN")
        self.assertTrue(get_user_model().objects.get(username=profile.email).check_password("AnotherStrong9921"))

    def test_manager_cannot_create_an_admin(self):
        token = self._token_for("manager@example.com", "MANAGER")

        response = self.client.post(
            "/api/admin/create-user",
            {"email": "blocked-admin@example.com", "password": "AnotherStrong9921", "role": "ADMIN"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(UserProfile.objects.filter(email="blocked-admin@example.com").exists())