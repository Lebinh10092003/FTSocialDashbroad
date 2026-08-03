import time
import logging
import requests
import datetime
import os
from django.utils import timezone
import json
import zlib
from authentication.models import SystemConfig

logger = logging.getLogger(__name__)

class SocialPostRaw:
    def __init__(self, id, message=None, created_time=None, permalink_url=None, post_type=None, image_url=None):
        self.id = id
        self.message = message
        self.created_time = created_time
        self.permalink_url = permalink_url
        self.post_type = post_type
        self.image_url = image_url

def generate_deterministic_metrics(post_id, platform):
    seed = zlib.crc32(post_id.encode('utf-8'))
    base = 50 + (seed % 450)
    
    if platform == 'facebook':
        views = base * 4 + (seed % 150)
        reach = int(views * 0.85)
        impressions = int(views * 1.2)
        reactions = int(views * 0.15) + (seed % 20)
        comments = int(reactions * 0.25) + (seed % 10)
        shares = int(reactions * 0.1) + (seed % 5)
        clicks = int(reach * 0.08) + (seed % 15)
    else:
        views = base * 2 + (seed % 100)
        reach = int(views * 0.8)
        impressions = int(views * 1.1)
        reactions = int(views * 0.1) + (seed % 15)
        comments = int(reactions * 0.2) + (seed % 5)
        shares = int(reactions * 0.05) + (seed % 3)
        clicks = int(reach * 0.06) + (seed % 10)
        
    return {
        'id': post_id,
        'reactions': max(reactions, 0),
        'comments': max(comments, 0),
        'shares': max(shares, 0),
        'views': max(views, 0),
        'reach': max(reach, 0),
        'impressions': max(impressions, 0),
        'clicks': max(clicks, 0)
    }

def fetch_with_retry(url, headers=None, params=None, method='GET', data=None, retries=3, delay=1.0):
    for i in range(retries + 1):
        status_code = None
        try:
            if method.upper() == 'POST':
                res = requests.post(url, headers=headers, json=data, params=params, timeout=10)
            else:
                res = requests.get(url, headers=headers, params=params, timeout=10)
            
            status_code = res.status_code
            if status_code == 429:
                if i < retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
            
            res.raise_for_status()
            return res.json()
        except Exception as e:
            # Không thử lại đối với các lỗi cố định từ phía client (sai token, hết hạn, không tìm thấy)
            if status_code in [400, 401, 403, 404]:
                raise e
            if i == retries:
                raise e
            time.sleep(delay)
            delay *= 2


class FacebookProvider:
    def __init__(self):
        config = SystemConfig.objects.filter(key='main').first()
        self.api_version = 'v25.0'
        self.last_validation_error = ""
        if config and config.data:
            self.api_version = config.data.get('metaGraphApiVersion', 'v25.0')

    def get_token(self, external_id):
        config = SystemConfig.objects.filter(key='main').first()
        if config and config.data:
            tokens_json = config.data.get('metaPageTokensJson')
            if tokens_json:
                try:
                    tokens = json.loads(tokens_json)
                    token = tokens.get(external_id)
                    if token:
                        return token
                except Exception:
                    pass
        return os.getenv("CURRENT_FACEBOOK_ACCESS_TOKEN", "").strip()

    @staticmethod
    def _status_code(error):
        response = getattr(error, "response", None)
        return getattr(response, "status_code", None)

    @staticmethod
    def _clean_scan_label(item):
        label = str(item.get("label") or "").strip()
        if not label or "?" in label or label.lower().startswith("token qu"):
            return "Token quét Facebook (hiện tại)" if item.get("id") == "facebook-scan-current" else "Token quét Facebook"
        return label

    def _scan_context(self, external_id):
        config = SystemConfig.objects.filter(key="main").first()
        if not config or not config.data:
            return config, {}, None
        data = dict(config.data)
        rows = [dict(item) for item in data.get("detailedTokensList", []) if isinstance(item, dict)]
        scans = [dict(item) for item in data.get("facebookScanTokens", []) if isinstance(item, dict)]
        page_row = next((item for item in rows if str(item.get("pageId") or "") == str(external_id)), None)
        source_id = str((page_row or {}).get("sourceTokenId") or "")
        scan = next((item for item in scans if str(item.get("id") or "") == source_id), None)
        if scan is None:
            scan = next((
                item for item in scans
                if str(external_id) in {str(value) for value in item.get("pageIds", [])}
            ), None)
        if scan is None and len(scans) == 1:
            scan = scans[0]
        return config, data, scan

    def _mark_scan_validation(self, external_id, status, message=""):
        config, data, selected = self._scan_context(external_id)
        if not config or selected is None:
            return
        scans = [dict(item) for item in data.get("facebookScanTokens", []) if isinstance(item, dict)]
        now = timezone.now().isoformat()
        for item in scans:
            if str(item.get("id") or "") != str(selected.get("id") or ""):
                continue
            item["label"] = self._clean_scan_label(item)
            item["validationStatus"] = status
            item["lastValidatedAt"] = now
            if message:
                item["lastValidationError"] = message
            else:
                item.pop("lastValidationError", None)
        data["facebookScanTokens"] = scans
        config.data = data
        config.save(update_fields=["data"])

    def rescan_saved_token(self, scan_token_id):
        """Discover every Page currently granted to one saved user token."""
        config = SystemConfig.objects.filter(key="main").first()
        if not config or not config.data:
            raise ValueError("Chưa có cấu hình token Facebook.")
        data = dict(config.data)
        scans = [dict(item) for item in data.get("facebookScanTokens", []) if isinstance(item, dict)]
        scan = next((item for item in scans if str(item.get("id") or "") == str(scan_token_id)), None)
        if not scan:
            raise ValueError("Không tìm thấy token Facebook đã lưu.")
        scan_token = str(scan.get("accessToken") or "").strip()
        if not scan_token:
            raise ValueError("Token Facebook đã lưu đang trống.")

        try:
            raw_pages = []
            after = None
            for _ in range(20):
                params = {"fields": "id,name,access_token", "limit": 100}
                if after:
                    params["after"] = after
                payload = fetch_with_retry(
                    f"https://graph.facebook.com/{self.api_version}/me/accounts",
                    headers={"Authorization": f"Bearer {scan_token}"},
                    params=params,
                )
                raw_pages.extend(payload.get("data", []))
                next_after = (
                    payload.get("paging", {})
                    .get("cursors", {})
                    .get("after")
                )
                if not next_after or next_after == after:
                    break
                after = next_after
        except requests.RequestException as error:
            invalid = self._status_code(error) in {400, 401, 403}
            message = (
                "Facebook đã từ chối token quét. Vui lòng nạp User Access Token mới."
                if invalid else "Không thể kết nối Facebook để quét lại danh sách trang."
            )
            for item in scans:
                if str(item.get("id") or "") == str(scan_token_id):
                    item["label"] = self._clean_scan_label(item)
                    item["validationStatus"] = "invalid" if invalid else "error"
                    item["lastValidatedAt"] = timezone.now().isoformat()
                    item["lastValidationError"] = message
            data["facebookScanTokens"] = scans
            config.data = data
            config.save(update_fields=["data"])
            raise ValueError(message) from error

        pages = [
            {
                "id": str(item.get("id") or "").strip(),
                "name": str(item.get("name") or "").strip(),
                "accessToken": str(item.get("access_token") or "").strip(),
            }
            for item in raw_pages
            if item.get("id") and item.get("access_token")
        ]
        if not pages:
            message = "Token còn hợp lệ nhưng chưa được cấp quyền quản trị Trang Facebook nào."
            for item in scans:
                if str(item.get("id") or "") == str(scan_token_id):
                    item["validationStatus"] = "invalid"
                    item["lastValidatedAt"] = timezone.now().isoformat()
                    item["lastValidationError"] = message
            data["facebookScanTokens"] = scans
            config.data = data
            config.save(update_fields=["data"])
            raise ValueError(message)

        rows = [dict(item) for item in data.get("detailedTokensList", []) if isinstance(item, dict)]
        rows_by_page = {
            str(item.get("pageId") or ""): index
            for index, item in enumerate(rows)
            if item.get("platform") == "facebook" and item.get("pageId")
        }
        added_page_ids = []
        issued_at = str(scan.get("issuedAt") or timezone.now().isoformat())
        expires_at = str(scan.get("expiresAt") or "")
        for page in pages:
            row = {
                "id": f"facebook-{page['id']}",
                "platform": "facebook",
                "pageId": page["id"],
                "pageName": page["name"] or f"Trang Facebook {page['id']}",
                "accessToken": page["accessToken"],
                "sourceTokenId": str(scan_token_id),
                "issuedAt": issued_at,
                "expiresAt": expires_at,
            }
            existing_index = rows_by_page.get(page["id"])
            if existing_index is None:
                rows.append(row)
                rows_by_page[page["id"]] = len(rows) - 1
                added_page_ids.append(page["id"])
            else:
                rows[existing_index] = {**rows[existing_index], **row}

        try:
            meta_tokens = json.loads(data.get("metaPageTokensJson") or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            meta_tokens = {}
        if not isinstance(meta_tokens, dict):
            meta_tokens = {}
        for page in pages:
            meta_tokens[page["id"]] = page["accessToken"]
        for item in scans:
            if str(item.get("id") or "") != str(scan_token_id):
                continue
            item["label"] = self._clean_scan_label(item)
            item["pageIds"] = [page["id"] for page in pages]
            item["pageNames"] = [page["name"] or page["id"] for page in pages]
            item["validationStatus"] = "valid"
            item["lastValidatedAt"] = timezone.now().isoformat()
            item.pop("lastValidationError", None)

        data["detailedTokensList"] = rows
        data["facebookScanTokens"] = scans
        data["metaPageTokensJson"] = json.dumps(meta_tokens, ensure_ascii=False)
        data["updatedAt"] = timezone.now().isoformat()
        config.data = data
        config.save(update_fields=["data"])
        return {
            "pages": [{"id": page["id"], "name": page["name"]} for page in pages],
            "addedPageIds": added_page_ids,
            "detailedTokensList": rows,
            "facebookScanTokens": scans,
            "metaPageTokensJson": data["metaPageTokensJson"],
        }

    def _refresh_page_tokens(self, external_id):
        config, data, scan = self._scan_context(external_id)
        if not config or not scan:
            self.last_validation_error = "Không tìm thấy token quét Facebook dùng để làm mới quyền truy cập."
            return None
        scan_token = str(scan.get("accessToken") or "").strip()
        if not scan_token:
            self.last_validation_error = "Token quét Facebook đang trống."
            return None
        if scan.get("validationStatus") == "invalid":
            try:
                checked_at = datetime.datetime.fromisoformat(str(scan.get("lastValidatedAt") or "").replace("Z", "+00:00"))
                if timezone.now() - checked_at < datetime.timedelta(minutes=10):
                    self.last_validation_error = str(scan.get("lastValidationError") or "Token Facebook không còn hợp lệ.")
                    return None
            except (TypeError, ValueError):
                pass
        try:
            payload = fetch_with_retry(
                f"https://graph.facebook.com/{self.api_version}/me/accounts",
                headers={"Authorization": f"Bearer {scan_token}"},
                params={"fields": "id,name,access_token", "limit": 100},
            )
        except requests.RequestException as error:
            invalid = self._status_code(error) in {400, 401, 403}
            self.last_validation_error = (
                "Facebook đã từ chối token quét. Vui lòng nạp lại User Access Token hợp lệ trong Cấu hình hệ thống."
                if invalid else "Không thể kết nối Facebook để làm mới token."
            )
            self._mark_scan_validation(external_id, "invalid" if invalid else "error", self.last_validation_error)
            return None

        page_tokens = {
            str(item.get("id") or ""): str(item.get("access_token") or "").strip()
            for item in payload.get("data", [])
            if item.get("id") and item.get("access_token")
        }
        refreshed = page_tokens.get(str(external_id))
        if not refreshed:
            self.last_validation_error = "Token quét không còn quyền quản trị trang Facebook này."
            self._mark_scan_validation(external_id, "invalid", self.last_validation_error)
            return None

        rows = [dict(item) for item in data.get("detailedTokensList", []) if isinstance(item, dict)]
        meta_tokens = {}
        try:
            meta_tokens = json.loads(data.get("metaPageTokensJson") or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            meta_tokens = {}
        if not isinstance(meta_tokens, dict):
            meta_tokens = {}
        for item in rows:
            page_id = str(item.get("pageId") or "")
            if page_id in page_tokens:
                item["accessToken"] = page_tokens[page_id]
                meta_tokens[page_id] = page_tokens[page_id]
        scans = [dict(item) for item in data.get("facebookScanTokens", []) if isinstance(item, dict)]
        for item in scans:
            if str(item.get("id") or "") == str(scan.get("id") or ""):
                item["label"] = self._clean_scan_label(item)
                item["validationStatus"] = "valid"
                item["lastValidatedAt"] = timezone.now().isoformat()
                item.pop("lastValidationError", None)
        data["detailedTokensList"] = rows
        data["facebookScanTokens"] = scans
        data["metaPageTokensJson"] = json.dumps(meta_tokens, ensure_ascii=False)
        config.data = data
        config.save(update_fields=["data"])
        return refreshed

    def validate_credentials(self, channel_id, external_id):
        token = self.get_token(external_id)
        if not token:
            refreshed = self._refresh_page_tokens(external_id)
            if not refreshed:
                self.last_validation_error = self.last_validation_error or "Chưa cấu hình token Facebook cho trang này."
                return False
            token = refreshed
        url = f"https://graph.facebook.com/{self.api_version}/{external_id}"
        try:
            fetch_with_retry(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params={"fields": "id,name"},
            )
            self._mark_scan_validation(external_id, "valid")
            return True
        except requests.RequestException as error:
            if self._status_code(error) in {400, 401, 403}:
                refreshed = self._refresh_page_tokens(external_id)
                if refreshed:
                    try:
                        fetch_with_retry(
                            url,
                            headers={"Authorization": f"Bearer {refreshed}"},
                            params={"fields": "id,name"},
                        )
                        self._mark_scan_validation(external_id, "valid")
                        return True
                    except requests.RequestException:
                        pass
            self.last_validation_error = self.last_validation_error or (
                "Facebook đã từ chối token của trang. Vui lòng nạp lại token trong Cấu hình hệ thống."
            )
            self._mark_scan_validation(external_id, "invalid", self.last_validation_error)
            return False


    def get_followers(self, channel_id, external_id):
        token = self.get_token(external_id)
        if token == "fb_mock_token_for_page":
            return 12500

        url = f"https://graph.facebook.com/{self.api_version}/{external_id}"
        data = fetch_with_retry(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"fields": "followers_count"},
        )
        return int(data.get("followers_count", 0) or 0)

    @staticmethod
    def _insight_snapshot_date(end_time):
        value = str(end_time or "").strip()
        if not value:
            return None
        try:
            parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
            if timezone.is_naive(parsed):
                parsed = timezone.make_aware(parsed, datetime.timezone.utc)
            return timezone.localtime(parsed).date().isoformat()
        except (TypeError, ValueError):
            return value[:10] or None

    def get_follower_insights(self, channel_id, external_id, since=None, until=None):
        """Return Page Insights grouped by day without exposing access tokens.

        Meta rejects the three required Page metrics when they are sent as a
        comma-separated value, so fetch each daily metric independently.
        """
        token = self.get_token(external_id)
        if token == "fb_mock_token_for_page":
            return []

        metric_fields = {
            "page_follows": "followers_count",
            "page_daily_follows_unique": "daily_follows_unique",
            "page_daily_unfollows_unique": "daily_unfollows_unique",
        }
        start_date = timezone.localtime(since).date() if since else None
        end_date = timezone.localtime(until).date() if until else None
        ranges = [(start_date, end_date)]
        if start_date and end_date:
            # Meta returns an empty result for these Page metrics when the
            # queried date range is too large. Keep each call within 90 days;
            # overlapping boundaries are safely merged by snapshot date.
            ranges = []
            range_start = start_date
            while range_start <= end_date:
                range_end = min(range_start + datetime.timedelta(days=89), end_date)
                ranges.append((range_start, range_end))
                range_start = range_end + datetime.timedelta(days=1)

        by_date = {}
        for range_start, range_end in ranges:
            for metric_name, field in metric_fields.items():
                params = {"metric": metric_name, "period": "day"}
                if range_start:
                    # Page Insights accepts calendar boundaries reliably. Unix
                    # timestamps can yield an empty data set for these metrics.
                    params["since"] = range_start.isoformat()
                if range_end:
                    params["until"] = range_end.isoformat()
                try:
                    payload = fetch_with_retry(
                        f"https://graph.facebook.com/{self.api_version}/{external_id}/insights",
                        headers={"Authorization": f"Bearer {token}"},
                        params=params,
                    )
                except requests.RequestException as exc:
                    # Insights require Page analysis permissions. Keep post syncing
                    # available for a Page that has not yet granted this scope.
                    logger.warning(
                        "Page Insight %s unavailable for Facebook Page %s: %s",
                        metric_name,
                        external_id,
                        exc,
                    )
                    continue

                for metric in payload.get("data", []):
                    for point in metric.get("values", []) or []:
                        snapshot_date = self._insight_snapshot_date(point.get("end_time"))
                        if not snapshot_date:
                            continue
                        raw_value = point.get("value")
                        if isinstance(raw_value, dict):
                            raw_value = raw_value.get("value")
                        try:
                            value = int(raw_value)
                        except (TypeError, ValueError):
                            continue
                        by_date.setdefault(snapshot_date, {"snapshot_date": snapshot_date})[field] = value

        return [by_date[key] for key in sorted(by_date)]

    def list_posts(self, channel_id, external_id, since=None, until=None):
        token = self.get_token(external_id)
        if token == "fb_mock_token_for_page":
            return [
                {
                    "id": "fb_post_1",
                    "message": "Bài viết Facebook số 1 - Chào hè rực rỡ!",
                    "created_time": timezone.now().isoformat(),
                    "permalink_url": "https://facebook.com/fb_post_1",
                    "post_type": "photo",
                },
                {
                    "id": "fb_post_2",
                    "message": "Bài viết Facebook số 2 - Thông báo lịch thi khảo thí quốc tế",
                    "created_time": (timezone.now() - datetime.timedelta(days=2)).isoformat(),
                    "permalink_url": "https://facebook.com/fb_post_2",
                    "post_type": "link",
                },
            ]

        url = f"https://graph.facebook.com/{self.api_version}/{external_id}/published_posts"
        headers = {"Authorization": f"Bearer {token}"}
        params = {
            "fields": (
                "id,message,created_time,permalink_url,full_picture,"
                "attachments{media_type,url,media{image{src}}}"
            ),
            "limit": 100,
        }
        if since:
            params["since"] = int(since.timestamp())
        if until:
            params["until"] = int(until.timestamp())

        posts = []
        seen_ids = set()
        seen_cursors = set()
        after = None

        while True:
            if after:
                if after in seen_cursors:
                    logger.warning("Facebook returned a repeated pagination cursor for Page %s", external_id)
                    break
                seen_cursors.add(after)
                params["after"] = after
            response = fetch_with_retry(url, headers=headers, params=params)
            items = response.get("data", [])

            for item in items:
                post_id = item.get("id")
                if not post_id or post_id in seen_ids:
                    continue
                seen_ids.add(post_id)

                post_type = "status"
                image_url = item.get("full_picture")
                attachments = item.get("attachments", {}).get("data", [])
                if attachments:
                    media_type = attachments[0].get("media_type", "").lower()
                    if "photo" in media_type or "album" in media_type:
                        post_type = "photo"
                    elif "video" in media_type:
                        post_type = "video"
                    else:
                        post_type = "link"
                    if not image_url:
                        image_url = (
                            attachments[0]
                            .get("media", {})
                            .get("image", {})
                            .get("src")
                        )

                posts.append(
                    {
                        "id": post_id,
                        "message": item.get("message", ""),
                        "created_time": item.get("created_time"),
                        "permalink_url": item.get("permalink_url"),
                        "post_type": post_type,
                        "image_url": image_url,
                    }
                )

            after = (
                response.get("paging", {})
                .get("cursors", {})
                .get("after")
            )
            if not items or not after:
                break

        return posts

    def get_post_metrics(self, channel_id, external_id, posts):
        token = self.get_token(external_id)
        if token == "fb_mock_token_for_page":
            return [generate_deterministic_metrics(post["id"], "facebook") for post in posts]

        headers = {"Authorization": f"Bearer {token}"}
        result = []

        for post in posts:
            post_id = post["id"]
            insights_url = f"https://graph.facebook.com/{self.api_version}/{post_id}/insights"
            insights = fetch_with_retry(
                insights_url,
                headers=headers,
                params={
                    "metric": "post_media_view,post_total_media_view_unique"
                },
            )

            reach = 0
            impressions = 0
            clicks = 0
            for metric in insights.get("data", []):
                if metric.get("period") not in (None, "lifetime"):
                    continue
                name = metric.get("name")
                value = metric.get("values", [{}])[0].get("value", 0)
                if name == "post_total_media_view_unique":
                    reach = value
                elif name == "post_media_view":
                    impressions = value
                elif name == "post_clicks_by_type_unique":
                    clicks = sum(value.values()) if isinstance(value, dict) else value

            detail_url = f"https://graph.facebook.com/{self.api_version}/{post_id}"
            detail = fetch_with_retry(
                detail_url,
                headers=headers,
                params={"fields": "reactions.summary(true),comments.summary(true),shares"},
            )

            reactions = detail.get("reactions", {}).get("summary", {}).get("total_count", 0)
            comments = detail.get("comments", {}).get("summary", {}).get("total_count", 0)
            shares = detail.get("shares", {}).get("count", 0)

            result.append(
                {
                    "id": post_id,
                    "reactions": reactions,
                    "comments": comments,
                    "shares": shares,
                    "views": impressions,
                    "reach": reach,
                    "impressions": impressions,
                    "clicks": clicks,
                }
            )

        return result

    def normalize_post(self, raw, channel_id):
        post_key = f"facebook:{channel_id}:{raw['id']}"
        return {
            'post_key': post_key,
            'platform': 'facebook',
            'channel_id': channel_id,
            'external_post_id': raw['id'],
            'post_url': raw.get('permalink_url', ''),
            'image_url': raw.get('image_url'),
            'post_type': raw.get('post_type', 'status'),
            'message': raw.get('message', ''),
            'published_at': raw.get('created_time') or timezone.now().isoformat(),
            'imported_at': timezone.now().isoformat(),
            'updated_at': timezone.now().isoformat(),
            'is_deleted': False
        }

    def normalize_metrics(self, raw_metric, channel_id, post_key, snapshot_date):
        reactions = int(raw_metric.get('reactions', 0))
        comments = int(raw_metric.get('comments', 0))
        shares = int(raw_metric.get('shares', 0))
        clicks = int(raw_metric.get('clicks', 0))
        reach = int(raw_metric.get('reach', 0))
        impressions = int(raw_metric.get('impressions', 0))
        
        total_engagement = reactions + comments + shares + clicks
        engagement_rate = None
        if reach > 0:
            engagement_rate = (total_engagement / reach) * 100
        elif impressions > 0:
            engagement_rate = (total_engagement / impressions) * 100
            
        return {
            'snapshot_key': f"{snapshot_date}:{post_key}",
            'snapshot_date': snapshot_date,
            'platform': 'facebook',
            'channel_id': channel_id,
            'post_key': post_key,
            'reactions': reactions,
            'likes': reactions,
            'comments': comments,
            'shares': shares,
            'views': int(raw_metric.get('views', 0)),
            'reach': reach,
            'impressions': impressions,
            'clicks': clicks,
            'total_engagement': total_engagement,
            'engagement_rate': round(engagement_rate, 2) if engagement_rate is not None else None,
            'fetched_at': timezone.now()
        }

class ZaloOAProvider:
    def get_token(self, external_id):
        config = SystemConfig.objects.filter(key='main').first()
        if config and config.data:
            tokens_json = config.data.get('zaloOaTokensJson')
            if tokens_json:
                try:
                    tokens = json.loads(tokens_json)
                    token = tokens.get(external_id)
                    if token:
                        return token
                except Exception:
                    pass
        return "zalo_mock_token_for_oa"

    def validate_credentials(self, channel_id, external_id):
        return True

    def get_followers(self, channel_id, external_id):
        return 8200

    def list_posts(self, channel_id, external_id, since=None, until=None):
        return [
            {
                'id': 'zalo_post_1',
                'message': 'Bài viết Zalo số 1 - Chúc mừng các thí sinh xuất sắc!',
                'created_time': timezone.now().isoformat(),
                'permalink_url': 'https://oa.zalo.me/details/zalo_post_1',
                'post_type': 'article'
            },
            {
                'id': 'zalo_post_2',
                'message': 'Bài viết Zalo số 2 - Cập nhật lịch học ôn tập AYSBC',
                'created_time': (timezone.now() - datetime.timedelta(days=3)).isoformat(),
                'permalink_url': 'https://oa.zalo.me/details/zalo_post_2',
                'post_type': 'article'
            }
        ]

    def get_post_metrics(self, channel_id, external_id, posts):
        return [generate_deterministic_metrics(p['id'], 'zalo') for p in posts]

    def normalize_post(self, raw, channel_id):
        post_key = f"zalo:{channel_id}:{raw['id']}"
        return {
            'post_key': post_key,
            'platform': 'zalo',
            'channel_id': channel_id,
            'external_post_id': raw['id'],
            'post_url': raw.get('permalink_url', ''),
            'image_url': raw.get('image_url'),
            'post_type': raw.get('post_type', 'article'),
            'message': raw.get('message', ''),
            'published_at': raw.get('created_time') or timezone.now().isoformat(),
            'imported_at': timezone.now().isoformat(),
            'updated_at': timezone.now().isoformat(),
            'is_deleted': False
        }

    def normalize_metrics(self, raw_metric, channel_id, post_key, snapshot_date):
        reactions = int(raw_metric.get('reactions', 0))
        comments = int(raw_metric.get('comments', 0))
        shares = int(raw_metric.get('shares', 0))
        clicks = int(raw_metric.get('clicks', 0))
        reach = int(raw_metric.get('reach', 0))
        
        total_engagement = reactions + comments + shares + clicks
        engagement_rate = None
        if reach > 0:
            engagement_rate = (total_engagement / reach) * 100
            
        return {
            'snapshot_key': f"{snapshot_date}:{post_key}",
            'snapshot_date': snapshot_date,
            'platform': 'zalo',
            'channel_id': channel_id,
            'post_key': post_key,
            'reactions': reactions,
            'likes': reactions,
            'comments': comments,
            'shares': shares,
            'views': int(raw_metric.get('views', 0)),
            'reach': reach,
            'impressions': int(raw_metric.get('impressions', 0)),
            'clicks': clicks,
            'total_engagement': total_engagement,
            'engagement_rate': round(engagement_rate, 2) if engagement_rate is not None else None,
            'fetched_at': timezone.now()
        }

class MockProvider:
    def validate_credentials(self, channel_id, external_id):
        return True

    def get_followers(self, channel_id, external_id):
        return 4500

    def list_posts(self, channel_id, external_id, since=None, until=None):
        return [
            {
                'id': 'mock_post_1',
                'message': 'Bài viết Mock số 1 - Chúc mừng năm mới!',
                'created_time': timezone.now().isoformat(),
                'permalink_url': 'https://example.com/mock1',
                'post_type': 'photo'
            },
            {
                'id': 'mock_post_2',
                'message': 'Bài viết Mock số 2 - Ra mắt tính năng phân tích tương tác mạng xã hội',
                'created_time': (timezone.now() - datetime.timedelta(days=1)).isoformat(),
                'permalink_url': 'https://example.com/mock2',
                'post_type': 'video'
            }
        ]

    def get_post_metrics(self, channel_id, external_id, posts):
        return [generate_deterministic_metrics(p['id'], 'mock') for p in posts]

    def normalize_post(self, raw, channel_id):
        post_key = f"mock:{channel_id}:{raw['id']}"
        return {
            'post_key': post_key,
            'platform': 'mock',
            'channel_id': channel_id,
            'external_post_id': raw['id'],
            'post_url': raw.get('permalink_url', ''),
            'image_url': raw.get('image_url'),
            'post_type': raw.get('post_type', 'status'),
            'message': raw.get('message', ''),
            'published_at': raw.get('created_time') or timezone.now().isoformat(),
            'imported_at': timezone.now().isoformat(),
            'updated_at': timezone.now().isoformat(),
            'is_deleted': False
        }

    def normalize_metrics(self, raw_metric, channel_id, post_key, snapshot_date):
        reactions = int(raw_metric.get('reactions', 0))
        comments = int(raw_metric.get('comments', 0))
        shares = int(raw_metric.get('shares', 0))
        clicks = int(raw_metric.get('clicks', 0))
        reach = int(raw_metric.get('reach', 0))
        
        total_engagement = reactions + comments + shares + clicks
        engagement_rate = None
        if reach > 0:
            engagement_rate = (total_engagement / reach) * 100
            
        return {
            'snapshot_key': f"{snapshot_date}:{post_key}",
            'snapshot_date': snapshot_date,
            'platform': 'mock',
            'channel_id': channel_id,
            'post_key': post_key,
            'reactions': reactions,
            'likes': reactions,
            'comments': comments,
            'shares': shares,
            'views': int(raw_metric.get('views', 0)),
            'reach': reach,
            'impressions': int(raw_metric.get('impressions', 0)),
            'clicks': clicks,
            'total_engagement': total_engagement,
            'engagement_rate': round(engagement_rate, 2) if engagement_rate is not None else None,
            'fetched_at': timezone.now()
        }
