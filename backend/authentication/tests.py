from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from django.utils import timezone

from social.models import Channel
from .models import Department, SystemConfig, UserProfile
from .views import (
    SENSITIVE_CONFIG_KEYS,
    _bootstrap_admin,
    _get_config,
    _normalise_token_rows,
    _sync_channels,
    _sync_environment_scan_token,
)


class TokenLifecycleTests(TestCase):
    def test_environment_token_never_overwrites_admin_saved_token(self):
        now = timezone.now()
        data = {
            "facebookScanTokens": [{
                "id": "facebook-scan-current",
                "accessToken": "admin-saved-token",
                "issuedAt": now.isoformat(),
                "expiresAt": (now + timedelta(days=10)).isoformat(),
                "validationStatus": "valid",
                "pageIds": [],
                "pageNames": [],
            }],
        }

        with patch.dict("os.environ", {"CURRENT_FACEBOOK_ACCESS_TOKEN": "stale-deployment-token"}, clear=False):
            self.assertFalse(_sync_environment_scan_token(data, now))

        scan = data["facebookScanTokens"][0]
        self.assertEqual(scan["accessToken"], "admin-saved-token")
        self.assertEqual(scan["validationStatus"], "valid")

    def test_environment_token_seeds_an_empty_configuration(self):
        now = timezone.now()
        data = {"facebookScanTokens": []}

        with patch.dict("os.environ", {"CURRENT_FACEBOOK_ACCESS_TOKEN": "bootstrap-token"}, clear=False):
            self.assertTrue(_sync_environment_scan_token(data, now))

        scan = data["facebookScanTokens"][0]
        self.assertEqual(scan["accessToken"], "bootstrap-token")
        self.assertEqual(scan["validationStatus"], "unknown")

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

        with patch.dict("os.environ", {"CURRENT_FACEBOOK_ACCESS_TOKEN": ""}, clear=False):
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

class BootstrapAdminTests(TestCase):
    def test_json_bootstrap_provisions_additional_admin(self):
        with patch.dict("os.environ", {"BOOTSTRAP_ADMINS_JSON": "[{\"email\": \"extra-admin@example.com\", \"password\": \"StrongPassword9921\"}]", "BOOTSTRAP_ADMIN_EMAIL": "", "BOOTSTRAP_ADMIN_PASSWORD": ""}, clear=False):
            user = _bootstrap_admin("extra-admin@example.com", "StrongPassword9921")
        self.assertIsNotNone(user)
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.check_password("StrongPassword9921"))
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

    @patch("social.views._start_background_sync", return_value="background_test")
    @patch("social.providers.FacebookProvider.rescan_saved_token")
    def test_admin_can_refresh_saved_facebook_token_and_queue_discovered_pages(self, rescan, start_sync):
        token = self._token_for("facebook-owner@example.com", "ADMIN")
        rescan.return_value = {
            "pages": [
                {"id": "page-1", "name": "Page 1"},
                {"id": "page-2", "name": "Page 2"},
            ],
            "addedPageIds": ["page-2"],
            "detailedTokensList": [
                {"id": "facebook-page-1", "platform": "facebook", "pageId": "page-1", "pageName": "Page 1", "accessToken": "token-1"},
                {"id": "facebook-page-2", "platform": "facebook", "pageId": "page-2", "pageName": "Page 2", "accessToken": "token-2"},
            ],
            "facebookScanTokens": [{"id": "scan-1", "pageIds": ["page-1", "page-2"]}],
            "metaPageTokensJson": "{}",
        }

        response = self.client.post(
            "/api/admin/config/facebook-scan-tokens/scan-1/refresh",
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["addedPageCount"], 1)
        self.assertEqual(response.json()["syncQueued"], 2)
        self.assertEqual(Channel.objects.filter(platform="facebook", status="active").count(), 2)
        rescan.assert_called_once_with("scan-1")
        start_sync.assert_called_once()

    @patch("social.providers.FacebookProvider.rescan_saved_token")
    def test_manager_cannot_refresh_saved_facebook_token(self, rescan):
        token = self._token_for("facebook-manager@example.com", "MANAGER")

        response = self.client.post(
            "/api/admin/config/facebook-scan-tokens/scan-1/refresh",
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 403)
        rescan.assert_not_called()


class GoogleFormLinkResolutionTests(TestCase):
    def setUp(self):
        email = "qr-user@example.com"
        user = get_user_model().objects.create_user(username=email, email=email, password="StrongPassword9921")
        UserProfile.objects.create(email=email, name="QR User", role="EMPLOYEE")
        self.token = Token.objects.create(user=user).key

    def request(self, url):
        return self.client.post(
            "/api/auth/qr/resolve-google-form",
            {"url": url},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    @patch("authentication.views.requests.get")
    def test_resolves_a_valid_forms_short_link_to_the_full_google_form(self, get):
        response = get.return_value
        response.status_code = 302
        response.headers = {"Location": "https://docs.google.com/forms/d/e/form-id/viewform?usp=sf_link"}

        result = self.request("https://forms.gle/AbCdEf123")

        self.assertEqual(result.status_code, 200)
        self.assertEqual(
            result.json()["resolvedUrl"],
            "https://docs.google.com/forms/d/e/form-id/viewform?usp=sf_link",
        )
        get.assert_called_once()
        response.close.assert_called_once()

    @patch("authentication.views.requests.get")
    def test_rejects_an_invalid_dynamic_link_page(self, get):
        response = get.return_value
        response.status_code = 200
        response.headers = {}
        response.text = "<h1>Invalid Dynamic Link</h1>"

        result = self.request("https://forms.gle/incomplete")

        self.assertEqual(result.status_code, 400)
        self.assertIn("không còn hợp lệ", result.json()["error"])

    @patch("authentication.views.requests.get")
    def test_rejects_non_google_hosts_without_making_a_request(self, get):
        result = self.request("https://example.com/private")

        self.assertEqual(result.status_code, 400)
        get.assert_not_called()

    @patch("authentication.views.requests.get")
    def test_rejects_a_redirect_outside_the_google_form_allowlist(self, get):
        response = get.return_value
        response.status_code = 302
        response.headers = {"Location": "http://127.0.0.1/internal"}

        result = self.request("https://forms.gle/AbCdEf123")

        self.assertEqual(result.status_code, 400)
        get.assert_called_once()
        response.close.assert_called_once()

    @patch("authentication.views.requests.get")
    def test_reports_google_rate_limiting_as_a_temporary_failure(self, get):
        response = get.return_value
        response.status_code = 429
        response.headers = {}

        result = self.request("https://forms.gle/AbCdEf123")

        self.assertEqual(result.status_code, 503)
        self.assertTrue(result.json()["temporary"])


class PersistentLoginTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="remember@example.com", email="remember@example.com", password="StrongPassword9921"
        )
        UserProfile.objects.create(email="remember@example.com", name="Remember", role="EMPLOYEE")

    def test_login_reuses_existing_token_for_remembered_browser_session(self):
        first = self.client.post('/api/auth/login', {'email': 'remember@example.com', 'password': 'StrongPassword9921'}, content_type='application/json')
        second = self.client.post('/api/auth/login', {'email': 'remember@example.com', 'password': 'StrongPassword9921'}, content_type='application/json')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()['token'], second.json()['token'])
        self.assertEqual(Token.objects.filter(user=self.user).count(), 1)
    def test_user_can_change_password_with_the_current_password(self):
        previous_token = Token.objects.create(user=self.user).key
        response = self.client.post(
            '/api/auth/change-password',
            {'currentPassword': 'StrongPassword9921', 'newPassword': 'ChangedPassword9921'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {previous_token}',
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('ChangedPassword9921'))
        self.assertNotEqual(response.json()['token'], previous_token)
        self.assertEqual(Token.objects.filter(user=self.user).count(), 1)

    def test_password_change_requires_current_password(self):
        token = Token.objects.create(user=self.user).key
        response = self.client.post(
            '/api/auth/change-password',
            {'currentPassword': 'incorrect', 'newPassword': 'ChangedPassword9921'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}',
        )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(self.user.check_password('StrongPassword9921'))
class EmployeeDirectoryTests(TestCase):
    def setUp(self):
        self.admin_user = get_user_model().objects.create_user(
            username="hr-admin@example.com", email="hr-admin@example.com", password="StrongPassword9921"
        )
        UserProfile.objects.create(email="hr-admin@example.com", name="HR Admin", role="ADMIN")
        self.token = Token.objects.create(user=self.admin_user).key

    def request(self, method, path, payload=None):
        return getattr(self.client, method)(
            path,
            payload or {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_employee_create_and_directory_filters_keep_employee_fields(self):
        department = Department.objects.create(name="Công nghệ", code="TECH")
        response = self.request("post", "/api/auth/users", {
            "name": "Nhân viên mới",
            "email": "employee.new@example.com",
            "password": "AnotherStrong9921",
            "employeeCode": "FT-001",
            "departmentId": department.id,
            "employmentStatus": "PENDING",
            "role": "VIEWER",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["employeeCode"], "FT-001")
        listing = self.request("get", "/api/auth/users?department=%s" % department.id)
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["total"], 1)
        self.assertEqual(listing.json()["results"][0]["employmentStatus"], "PENDING")

    def test_cannot_delete_self_or_last_admin(self):
        self_response = self.request("delete", "/api/auth/users/hr-admin@example.com")
        self.assertEqual(self_response.status_code, 400)
        other = get_user_model().objects.create_user(
            username="second-hr@example.com", email="second-hr@example.com", password="StrongPassword9921"
        )
        UserProfile.objects.create(email=other.email, name="Second", role="ADMIN")
        delete_second = self.request("delete", "/api/auth/users/second-hr@example.com")
        self.assertEqual(delete_second.status_code, 200)
        self.assertTrue(UserProfile.objects.filter(email="hr-admin@example.com").exists())
class ModuleAccessTests(TestCase):
    def test_employee_is_limited_to_explicit_modules_while_admin_is_unrestricted(self):
        user = get_user_model().objects.create_user(
            username="module-user@example.com", email="module-user@example.com", password="StrongPassword9921"
        )
        UserProfile.objects.create(
            email=user.email,
            name="Module User",
            role="EMPLOYEE",
            access_modules=["social-dashboard", "examination"],
        )
        token = Token.objects.create(user=user).key
        denied = self.client.post(
            "/api/email-templates",
            {"id": "denied-template", "name": "Denied"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(denied.status_code, 403)

        admin = get_user_model().objects.create_user(
            username="module-admin@example.com", email="module-admin@example.com", password="StrongPassword9921"
        )
        UserProfile.objects.create(email=admin.email, name="Module Admin", role="ADMIN", access_modules=[])
        admin_token = Token.objects.create(user=admin).key
        allowed = self.client.get("/api/email-templates", HTTP_AUTHORIZATION=f"Bearer {admin_token}")
        self.assertEqual(allowed.status_code, 200)
