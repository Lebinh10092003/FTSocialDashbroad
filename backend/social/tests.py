import datetime
from datetime import timedelta
from io import BytesIO, StringIO
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from openpyxl import load_workbook

from .models import ApiLog, Channel, DailySnapshot, FollowerSnapshot, Post
from .providers import FacebookProvider
from .sync import SyncEngine
from .views import _start_background_sync


class FacebookPaginationTests(TestCase):
    @patch("social.providers.fetch_with_retry")
    def test_list_posts_follows_cursor_pagination(self, fetch):
        fetch.side_effect = [
            {
                "data": [
                    {
                        "id": "page_1",
                        "message": "One",
                        "created_time": timezone.now().isoformat(),
                    }
                ],
                "paging": {"cursors": {"after": "cursor_2"}},
            },
            {
                "data": [
                    {
                        "id": "page_2",
                        "message": "Two",
                        "created_time": timezone.now().isoformat(),
                    }
                ],
                "paging": {"cursors": {}},
            },
        ]

        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            posts = provider.list_posts(
                "channel",
                "page",
                since=timezone.now() - timedelta(days=90),
                until=timezone.now(),
            )

        self.assertEqual([post["id"] for post in posts], ["page_1", "page_2"])
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(fetch.call_args_list[1].kwargs["params"]["after"], "cursor_2")
        self.assertNotIn("access_token", fetch.call_args_list[0].kwargs["params"])

    @patch("social.providers.fetch_with_retry")
    def test_post_metrics_use_v25_media_view_fields(self, fetch):
        fetch.side_effect = [
            {
                "data": [
                    {"name": "post_media_view", "period": "lifetime", "values": [{"value": 123}]},
                    {"name": "post_total_media_view_unique", "period": "lifetime", "values": [{"value": 45}]},
                    {"name": "post_total_media_view_unique", "period": "day", "values": [{"value": 0}]},
                ]
            },
            {
                "reactions": {"summary": {"total_count": 5}},
                "comments": {"summary": {"total_count": 3}},
                "shares": {"count": 2},
            },
        ]

        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            metrics = provider.get_post_metrics("channel", "page", [{"id": "post"}])

        self.assertEqual(provider.api_version, "v25.0")
        self.assertEqual(metrics[0]["views"], 123)
        self.assertEqual(metrics[0]["reach"], 45)
        self.assertEqual(metrics[0]["clicks"], 0)
        requested = fetch.call_args_list[0].kwargs["params"]["metric"]
        self.assertIn("post_media_view", requested)
        self.assertNotIn("post_impressions", requested)
        self.assertNotIn("post_clicks", requested)


    @patch("social.providers.fetch_with_retry")
    def test_follower_insights_fetches_each_metric_separately(self, fetch):
        fetch.side_effect = [
            {"data": [{"name": "page_follows", "values": [{"value": 100, "end_time": "2026-07-22T07:00:00+0000"}]}]},
            {"data": [{"name": "page_daily_follows_unique", "values": [{"value": 4, "end_time": "2026-07-22T07:00:00+0000"}]}]},
            {"data": [{"name": "page_daily_unfollows_unique", "values": [{"value": 1, "end_time": "2026-07-22T07:00:00+0000"}]}]},
        ]
        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            rows = provider.get_follower_insights(
                "channel",
                "page",
                since=timezone.now() - timedelta(days=7),
                until=timezone.now(),
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["followers_count"], 100)
        self.assertEqual(rows[0]["daily_follows_unique"], 4)
        self.assertEqual(rows[0]["daily_unfollows_unique"], 1)
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(
            [call.kwargs["params"]["metric"] for call in fetch.call_args_list],
            ["page_follows", "page_daily_follows_unique", "page_daily_unfollows_unique"],
        )
        self.assertTrue(all("access_token" not in call.kwargs["params"] for call in fetch.call_args_list))


class SyncQueueTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.channel = Channel.objects.create(
            id='facebook:queue',
            platform='facebook',
            name='Queue Page',
            external_id='queue-page',
            status='active',
            created_at=now,
            updated_at=now,
        )

    def test_queued_log_changes_to_running_then_success(self):
        queued_log = SyncEngine.queue_channels([self.channel], 'queue_request')[self.channel.id]
        self.assertEqual(queued_log.status, 'queued')

        observed_statuses = []
        provider = Mock()

        def get_followers(*args):
            queued_log.refresh_from_db()
            observed_statuses.append(queued_log.status)
            return 10

        provider.get_followers.side_effect = get_followers
        provider.list_posts.return_value = []

        with patch.object(SyncEngine, 'get_provider', return_value=provider):
            success, _message = SyncEngine.sync_channel(
                self.channel.id,
                request_id='queue_request',
                queued_log=queued_log,
            )

        self.assertTrue(success)
        self.assertEqual(observed_statuses, ['running'])
        queued_log.refresh_from_db()
        self.assertEqual(queued_log.status, 'success')
        self.assertIsNotNone(queued_log.ended_at)

    @patch.object(SyncEngine, 'sync_channel')
    def test_sync_all_creates_queue_for_every_channel_before_processing(self, sync_channel):
        now = timezone.now()
        second_channel = Channel.objects.create(
            id='facebook:queue-two',
            platform='facebook',
            name='Queue Page Two',
            external_id='queue-page-two',
            status='active',
            created_at=now,
            updated_at=now,
        )
        queued_counts = []

        def complete_channel(channel_id, **kwargs):
            request_id = kwargs['request_id']
            queued_counts.append(
                ApiLog.objects.filter(request_id=request_id, status='queued').count()
            )
            log = kwargs['queued_log']
            log.status = 'success'
            log.ended_at = timezone.now()
            log.save(update_fields=['status', 'ended_at'])
            return True, 'ok'

        sync_channel.side_effect = complete_channel
        result = SyncEngine.sync_all_channels()

        self.assertTrue(result['success'])
        self.assertEqual(queued_counts[0], 2)
        self.assertEqual(
            set(ApiLog.objects.filter(request_id=result['requestId']).values_list('channel_id', flat=True)),
            {self.channel.id, second_channel.id},
        )


class BackgroundSyncTests(TestCase):
    @patch("social.views.subprocess.Popen")
    def test_background_sync_launches_one_year_management_command(self, popen):
        _start_background_sync(365)

        process_args = popen.call_args.args[0]
        self.assertIn("sync_social_daily", process_args)
        self.assertEqual(process_args.count("365"), 2)
        self.assertEqual(popen.call_args.kwargs["stdout"], -3)
        self.assertEqual(popen.call_args.kwargs["stderr"], -3)


class MediaSummaryExportTests(TestCase):
    def setUp(self):
        now = timezone.now()
        Channel.objects.create(
            id='facebook:report',
            platform='facebook',
            name='Trang bao cao',
            external_id='report-page',
            status='active',
            followers_count=123,
            created_at=now,
            updated_at=now,
        )

    def test_media_summary_xlsx_is_a_valid_workbook(self):
        response = self.client.get(
            '/api/reports/media-summary.xlsx',
            {
                'startDate': (timezone.now() - timedelta(days=365)).date().isoformat(),
                'endDate': timezone.localdate().isoformat(),
                'groupBy': 'month',
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        self.assertIn('.xlsx', response['Content-Disposition'])
        self.assertGreater(len(response.content), 1000)

        workbook = load_workbook(BytesIO(response.content), read_only=True)
        sheet = workbook.active
        self.assertEqual(sheet['A1'].value, 'BÁO CÁO TỔNG HỢP TRUYỀN THÔNG')
        self.assertEqual(sheet['A4'].value, 'STT')
        self.assertEqual(sheet['C5'].value, 'Trang bao cao')
        self.assertEqual(sheet['F5'].value, 123)


class DailySyncCommandTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.channel = Channel.objects.create(
            id="facebook:test",
            platform="facebook",
            name="Test Page",
            external_id="test",
            status="active",
            created_at=now,
            updated_at=now,
        )

    @patch("social.management.commands.sync_social_daily.SyncEngine.sync_channel")
    def test_initial_run_backfills_one_year(self, sync_channel):
        sync_channel.return_value = (True, "ok")

        call_command("sync_social_daily", stdout=StringIO())

        kwargs = sync_channel.call_args.kwargs
        self.assertIsNone(kwargs["snapshot_existing_since"])
        self.assertGreaterEqual(
            timezone.now() - kwargs["since"],
            timedelta(days=364),
        )

    @patch("social.management.commands.sync_social_daily.SyncEngine.sync_channel")
    def test_later_runs_refresh_and_snapshot_one_year(self, sync_channel):
        now = timezone.now()
        self.channel.last_sync_at = now
        self.channel.save(update_fields=["last_sync_at"])
        Post.objects.create(
            post_key="facebook:test:post",
            platform="facebook",
            channel_id=self.channel.id,
            external_post_id="post",
            post_url="https://example.com/post",
            post_type="photo",
            published_at=now,
            imported_at=now,
            updated_at=now,
        )
        sync_channel.return_value = (True, "ok")

        call_command("sync_social_daily", stdout=StringIO())

        kwargs = sync_channel.call_args.kwargs
        discovery_age = timezone.now() - kwargs["since"]
        snapshot_age = timezone.now() - kwargs["snapshot_existing_since"]
        self.assertTrue(timedelta(days=364) < discovery_age < timedelta(days=366))
        self.assertTrue(timedelta(days=364) < snapshot_age < timedelta(days=366))


class DashboardFilterConsistencyTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.period_end = timezone.localdate() - timedelta(days=1)
        self.period_start = self.period_end - timedelta(days=6)
        self.channel = Channel.objects.create(
            id="facebook:filtered",
            platform="facebook",
            name="Filtered Page",
            external_id="filtered-page",
            status="active",
            followers_count=999,
            created_at=now,
            updated_at=now,
        )
        self.other_channel = Channel.objects.create(
            id="facebook:other",
            platform="facebook",
            name="Other Page",
            external_id="other-page",
            status="active",
            followers_count=888,
            created_at=now,
            updated_at=now,
        )
        self.placeholder = Channel.objects.create(
            id="technical-placeholder",
            platform="facebook",
            name="Facebook",
            external_id="current-facebook-token",
            status="active",
            followers_count=777,
            created_at=now,
            updated_at=now,
        )

        self.recent_post = self._post(
            "recent",
            self.channel,
            self.period_end,
            "photo",
        )
        self.old_top_post = self._post(
            "old-top",
            self.channel,
            self.period_end - timedelta(days=90),
            "video",
        )
        self.other_post = self._post(
            "other",
            self.other_channel,
            self.period_end,
            "photo",
        )
        self.too_old_post = self._post(
            "too-old",
            self.channel,
            self.period_end - timedelta(days=400),
            "link",
        )

        self._snapshot(self.recent_post, self.channel, 10, 2, 3, 1, 4)
        self._snapshot(self.old_top_post, self.channel, 500, 5, 0, 0, 0)
        self._snapshot(self.other_post, self.other_channel, 900, 90, 0, 0, 0)
        self._snapshot(self.too_old_post, self.channel, 9000, 900, 0, 0, 0)

        self._follower_snapshot(self.channel, self.period_start - timedelta(days=1), 100)
        self._follower_snapshot(self.channel, self.period_end, 110, daily_follows_unique=12, daily_unfollows_unique=2)
        self._follower_snapshot(self.channel, self.period_end + timedelta(days=1), 999)
        self._follower_snapshot(self.other_channel, self.period_end, 220)
        self._follower_snapshot(self.placeholder, self.period_end, 777)

    def _post(self, suffix, channel, published_day, post_type):
        published_at = timezone.make_aware(datetime.datetime.combine(published_day, datetime.time(hour=8)))
        return Post.objects.create(
            post_key=f"{channel.id}:{suffix}",
            platform=channel.platform,
            channel_id=channel.id,
            external_post_id=suffix,
            post_url=f"https://example.com/{suffix}",
            post_type=post_type,
            message=suffix,
            published_at=published_at,
            imported_at=timezone.now(),
            updated_at=timezone.now(),
        )

    def _snapshot(self, post, channel, views, reactions, comments, shares, clicks):
        total = reactions + comments + shares + clicks
        DailySnapshot.objects.create(
            snapshot_key=f"{post.post_key}:{self.period_end.isoformat()}",
            snapshot_date=self.period_end.isoformat(),
            platform=channel.platform,
            channel_id=channel.id,
            post_key=post.post_key,
            reactions=reactions,
            likes=reactions,
            comments=comments,
            shares=shares,
            clicks=clicks,
            views=views,
            reach=max(views, 1),
            impressions=max(views, 1),
            total_engagement=total,
            fetched_at=timezone.now(),
        )

    def _follower_snapshot(self, channel, snapshot_day, followers, daily_follows_unique=None, daily_unfollows_unique=None):
        FollowerSnapshot.objects.create(
            snapshot_key=f"{channel.id}:{snapshot_day.isoformat()}",
            snapshot_date=snapshot_day.isoformat(),
            channel_id=channel.id,
            channel_name=channel.name,
            followers_count=followers,
            daily_follows_unique=daily_follows_unique,
            daily_unfollows_unique=daily_unfollows_unique,
            fetched_at=timezone.now(),
        )

    def _filters(self):
        return {
            "startDate": self.period_start.isoformat(),
            "endDate": self.period_end.isoformat(),
            "platform": "facebook",
            "channelId": self.channel.id,
        }

    def test_every_dashboard_section_uses_selected_scope_except_one_year_top_views(self):
        response = self.client.get('/api/dashboard', self._filters())
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data['kpis']['postsCount'], 1)
        self.assertEqual(data['kpis']['views'], 10)
        self.assertEqual(data['kpis']['totalEngagement'], 10)
        self.assertEqual(data['kpis']['followers'], 110)
        self.assertTrue(data['kpis']['followersAvailable'])
        self.assertEqual([item['channelName'] for item in data['channelStats']], [self.channel.name])
        self.assertEqual([item['postKey'] for item in data['topPosts']], [self.recent_post.post_key])
        self.assertEqual([item['type'] for item in data['typeStats']], ['Ảnh / Album'])
        self.assertEqual([item['date'] for item in data['trends']], [self.period_end.isoformat()])

        top_viewed_keys = [item['postKey'] for item in data['topViewedPosts']]
        self.assertEqual(top_viewed_keys[0], self.old_top_post.post_key)
        self.assertIn(self.recent_post.post_key, top_viewed_keys)
        self.assertNotIn(self.other_post.post_key, top_viewed_keys)
        self.assertNotIn(self.too_old_post.post_key, top_viewed_keys)

    def test_follower_trend_uses_exact_dates_and_selected_channel(self):
        response = self.client.get('/api/followers/trend', self._filters())
        self.assertEqual(response.status_code, 200)
        trend = response.json()
        self.assertEqual(len(trend), 7)
        self.assertEqual(trend[0], {
            'date': self.period_start.isoformat(),
            'followersCount': 100,
            'dailyFollowsUnique': None,
            'dailyUnfollowsUnique': None,
        })
        self.assertEqual(trend[-1], {
            'date': self.period_end.isoformat(),
            'followersCount': 110,
            'dailyFollowsUnique': 12,
            'dailyUnfollowsUnique': 2,
        })

    def test_technical_facebook_placeholder_is_not_returned_as_a_channel(self):
        response = self.client.get('/api/channels')
        self.assertEqual(response.status_code, 200)
        external_ids = [item['externalId'] for item in response.json()]
        self.assertNotIn('current-facebook-token', external_ids)
