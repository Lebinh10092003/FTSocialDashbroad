import time
import requests
import datetime
import os
from django.utils import timezone
import json
import zlib
from authentication.models import SystemConfig

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
        return os.getenv("CURRENT_FACEBOOK_ACCESS_TOKEN", "").strip() or "fb_mock_token_for_page"

    def validate_credentials(self, channel_id, external_id):
        return True

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
        after = None

        for _page_number in range(100):
            if after:
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
