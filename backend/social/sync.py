import datetime
import uuid

from django.utils import timezone
from django.utils.dateparse import parse_date

from .models import ApiLog, Channel, DailySnapshot, FollowerSnapshot, Post
from .providers import FacebookProvider, MockProvider, ZaloOAProvider


DEFAULT_SYNC_DAYS = 365


class SyncEngine:
    @staticmethod
    def queue_channels(channels, request_id):
        queued_at = timezone.now()
        queued_logs = {}
        for channel in channels:
            log = ApiLog.objects.create(
                log_id=f"queue_{int(queued_at.timestamp() * 1000)}_{uuid.uuid4().hex[:5]}",
                started_at=queued_at,
                platform=channel.platform,
                action="sync_channel",
                channel_id=channel.id,
                status="queued",
                request_id=request_id,
            )
            queued_logs[channel.id] = log
        return queued_logs

    @staticmethod
    def get_provider(platform):
        platform = platform.lower()
        if platform == "facebook":
            return FacebookProvider()
        if platform == "zalo":
            return ZaloOAProvider()
        return MockProvider()

    @staticmethod
    def _parse_boundary(value, end_of_day=False):
        if not value or isinstance(value, datetime.datetime):
            return value
        if isinstance(value, datetime.date):
            parsed = value
        else:
            parsed = parse_date(str(value))
        if not parsed:
            return value

        boundary_time = datetime.time.max if end_of_day else datetime.time.min
        result = datetime.datetime.combine(parsed, boundary_time)
        return timezone.make_aware(result, timezone.get_current_timezone())

    @staticmethod
    def _save_snapshot(provider, channel, post_key, raw_metric, snapshot_date):
        metric_data = provider.normalize_metrics(raw_metric, channel.id, post_key, snapshot_date)
        DailySnapshot.objects.update_or_create(
            snapshot_key=metric_data["snapshot_key"],
            defaults={
                "snapshot_date": metric_data["snapshot_date"],
                "platform": metric_data["platform"],
                "channel_id": metric_data["channel_id"],
                "post_key": metric_data["post_key"],
                "reactions": metric_data["reactions"],
                "likes": metric_data["likes"],
                "comments": metric_data["comments"],
                "shares": metric_data["shares"],
                "views": metric_data["views"],
                "reach": metric_data["reach"],
                "impressions": metric_data["impressions"],
                "clicks": metric_data["clicks"],
                "total_engagement": metric_data["total_engagement"],
                "engagement_rate": metric_data["engagement_rate"],
                "fetched_at": metric_data["fetched_at"],
            },
        )

    @classmethod
    def sync_channel(
        cls,
        channel_id,
        request_id=None,
        since=None,
        until=None,
        snapshot_existing_since=None,
        queued_log=None,
    ):
        request_id = request_id or f"req_{uuid.uuid4().hex[:10]}"
        started_at = timezone.now()
        log_id = f"sync_{int(started_at.timestamp() * 1000)}_{uuid.uuid4().hex[:5]}"

        since = cls._parse_boundary(since)
        until = cls._parse_boundary(until, end_of_day=True)
        snapshot_existing_since = cls._parse_boundary(snapshot_existing_since)

        if not since:
            since = timezone.now() - datetime.timedelta(days=DEFAULT_SYNC_DAYS)
        if not until:
            until = timezone.now()

        try:
            channel = Channel.objects.get(id=channel_id)
        except Channel.DoesNotExist:
            if queued_log:
                queued_log.status = "failed"
                queued_log.ended_at = timezone.now()
                queued_log.error_code = "CHANNEL_NOT_FOUND"
                queued_log.error_message = "Channel not found"
                queued_log.save(
                    update_fields=[
                        "status",
                        "ended_at",
                        "error_code",
                        "error_message",
                    ]
                )
            else:
                ApiLog.objects.create(
                    log_id=log_id,
                    started_at=started_at,
                    ended_at=timezone.now(),
                    platform="unknown",
                    action="sync_channel",
                    channel_id=channel_id,
                    status="failed",
                    error_code="CHANNEL_NOT_FOUND",
                    error_message="Channel not found",
                    request_id=request_id,
                )
            return False, "Không tìm thấy kênh"

        if queued_log:
            api_log = queued_log
            api_log.started_at = started_at
            api_log.platform = channel.platform
            api_log.status = "running"
            api_log.ended_at = None
            api_log.error_code = None
            api_log.error_message = None
            api_log.save(
                update_fields=[
                    "started_at",
                    "platform",
                    "status",
                    "ended_at",
                    "error_code",
                    "error_message",
                ]
            )
        else:
            api_log = ApiLog.objects.create(
                log_id=log_id,
                started_at=started_at,
                platform=channel.platform,
                action="sync_channel",
                channel_id=channel_id,
                status="running",
                request_id=request_id,
            )

        try:
            provider = cls.get_provider(channel.platform)
            snapshot_date = timezone.localdate().isoformat()

            followers = provider.get_followers(channel.id, channel.external_id)
            raw_follower_insights = getattr(provider, "get_follower_insights", lambda *_args, **_kwargs: [])(
                channel.id,
                channel.external_id,
                since=since,
                until=until,
            )
            follower_insights = raw_follower_insights if isinstance(raw_follower_insights, list) else []
            for insight in follower_insights:
                if not isinstance(insight, dict):
                    continue
                insight_date = str(insight.get("snapshot_date") or "").strip()
                if not insight_date or "followers_count" not in insight:
                    continue
                defaults = {
                    "snapshot_date": insight_date,
                    "channel_id": channel.id,
                    "channel_name": channel.name,
                    "followers_count": insight["followers_count"],
                    "fetched_at": timezone.now(),
                }
                for field in ("daily_follows_unique", "daily_unfollows_unique"):
                    if field in insight:
                        defaults[field] = insight[field]
                FollowerSnapshot.objects.update_or_create(
                    snapshot_key=f"{insight_date}:{channel.id}",
                    defaults=defaults,
                )

            # The regular Page field is the freshest stock count. Do not overwrite
            # same-day daily Insights values that may already have been saved above.
            FollowerSnapshot.objects.update_or_create(
                snapshot_key=f"{snapshot_date}:{channel.id}",
                defaults={
                    "snapshot_date": snapshot_date,
                    "channel_id": channel.id,
                    "channel_name": channel.name,
                    "followers_count": followers,
                    "fetched_at": timezone.now(),
                },
            )

            raw_posts = provider.list_posts(
                channel.id,
                channel.external_id,
                since=since,
                until=until,
            )
            raw_posts = [post for post in raw_posts if post.get("id")]
            api_log.records_received = len(raw_posts)

            inserted = 0
            updated = 0
            post_keys_by_external_id = {}

            for raw_post in raw_posts:
                post_data = provider.normalize_post(raw_post, channel.id)
                post_obj, created = Post.objects.update_or_create(
                    post_key=post_data["post_key"],
                    defaults={
                        "platform": post_data["platform"],
                        "channel_id": post_data["channel_id"],
                        "external_post_id": post_data["external_post_id"],
                        "post_url": post_data["post_url"],
                        "image_url": post_data.get("image_url"),
                        "post_type": post_data["post_type"],
                        "message": post_data.get("message"),
                        "published_at": post_data["published_at"],
                        "imported_at": post_data["imported_at"],
                        "updated_at": post_data["updated_at"],
                        "is_deleted": post_data["is_deleted"],
                    },
                )
                post_keys_by_external_id[raw_post["id"]] = post_obj.post_key
                if created:
                    inserted += 1
                else:
                    updated += 1

            metric_targets = list(raw_posts)
            if snapshot_existing_since:
                known_external_ids = set(post_keys_by_external_id)
                tracked_posts = Post.objects.filter(
                    channel_id=channel.id,
                    is_deleted=False,
                    published_at__gte=snapshot_existing_since,
                    published_at__lte=until,
                ).only("post_key", "external_post_id")

                for tracked_post in tracked_posts.iterator():
                    if tracked_post.external_post_id in known_external_ids:
                        continue
                    known_external_ids.add(tracked_post.external_post_id)
                    post_keys_by_external_id[tracked_post.external_post_id] = tracked_post.post_key
                    metric_targets.append({"id": tracked_post.external_post_id})

            snapshots_saved = 0
            if metric_targets:
                metrics = provider.get_post_metrics(
                    channel.id,
                    channel.external_id,
                    metric_targets,
                )
                for raw_metric in metrics:
                    external_id = raw_metric.get("id")
                    post_key = post_keys_by_external_id.get(external_id)
                    if not post_key:
                        continue
                    cls._save_snapshot(
                        provider,
                        channel,
                        post_key,
                        raw_metric,
                        snapshot_date,
                    )
                    snapshots_saved += 1

            channel.followers_count = followers
            channel.total_posts = Post.objects.filter(
                channel_id=channel.id,
                is_deleted=False,
            ).count()
            channel.last_sync_at = timezone.now()
            channel.last_sync_status = "success"
            channel.save(
                update_fields=[
                    "followers_count",
                    "total_posts",
                    "last_sync_at",
                    "last_sync_status",
                ]
            )

            api_log.status = "success"
            api_log.records_inserted = inserted
            api_log.records_updated = updated
            api_log.ended_at = timezone.now()
            api_log.save(
                update_fields=[
                    "status",
                    "records_received",
                    "records_inserted",
                    "records_updated",
                    "ended_at",
                ]
            )

            return (
                True,
                f"Thành công: thêm {inserted}, cập nhật {updated}, "
                f"lưu {snapshots_saved} snapshot ngày.",
            )

        except Exception as exc:
            channel.last_sync_status = "failed"
            channel.save(update_fields=["last_sync_status"])

            api_log.status = "failed"
            api_log.error_code = "SYNC_ERROR"
            api_log.error_message = str(exc)
            api_log.ended_at = timezone.now()
            api_log.save(
                update_fields=[
                    "status",
                    "error_code",
                    "error_message",
                    "ended_at",
                    "records_received",
                ]
            )
            return False, f"Lỗi đồng bộ: {exc}"

    @classmethod
    def sync_all_channels(
        cls,
        google_token=None,
        since=None,
        until=None,
        snapshot_existing_since=None,
    ):
        request_id = f"req_{uuid.uuid4().hex[:10]}"
        active_channels = list(Channel.objects.filter(status="active").order_by("name"))
        queued_logs = cls.queue_channels(active_channels, request_id)

        success_count = 0
        total_count = len(active_channels)
        results = []

        for channel in active_channels:
            success, message = cls.sync_channel(
                channel.id,
                request_id=request_id,
                since=since,
                until=until,
                snapshot_existing_since=snapshot_existing_since,
                queued_log=queued_logs[channel.id],
            )
            if success:
                success_count += 1
            results.append(
                {
                    "channel_id": channel.id,
                    "name": channel.name,
                    "success": success,
                    "message": message,
                }
            )

        return {
            "success": total_count > 0 and success_count == total_count,
            "message": (
                f"Đã đồng bộ thành công {success_count}/{total_count} "
                f"kênh đang hoạt động."
            ),
            "results": results,
            "requestId": request_id,
        }
