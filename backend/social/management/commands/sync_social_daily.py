import datetime
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from social.models import ApiLog, Channel
from social.sync import SyncEngine


class Command(BaseCommand):
    help = (
        "Load one year of posts, post metrics and follower history once; "
        "then refresh only the new day."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--initial-days",
            type=int,
            default=396,
            help="Initial history window: one year plus a one-month comparison buffer (default: 396 days).",
        )
        parser.add_argument(
            "--recent-days",
            type=int,
            default=1,
            help="Post and follower refresh window after the first run (default: 1 day).",
        )
        parser.add_argument(
            "--channel-id",
            action="append",
            default=[],
            help="Only sync this channel; may be supplied more than once.",
        )
        parser.add_argument(
            "--request-id",
            default="",
            help="Existing background sync request identifier, if one was pre-queued.",
        )
        parser.add_argument("--since", default="", help="Optional inclusive manual start date (YYYY-MM-DD).")
        parser.add_argument("--until", default="", help="Optional inclusive manual end date (YYYY-MM-DD).")
        parser.add_argument("--force-history", action="store_true", help="Apply the initial history window even for an existing channel.")
    def handle(self, *args, **options):
        initial_days = options["initial_days"]
        recent_days = options["recent_days"]
        if not 1 <= recent_days <= initial_days:
            raise CommandError("--recent-days must be between 1 and --initial-days.")
        if initial_days > 3650:
            raise CommandError("--initial-days cannot exceed 3650 days.")

        selected_channel_ids = [str(value).strip() for value in options.get("channel_id", []) if str(value).strip()]
        channels = Channel.objects.filter(status="active")
        if selected_channel_ids:
            channels = channels.filter(id__in=selected_channel_ids)
        active_channels = list(channels.order_by("name"))
        if not active_channels:
            raise CommandError("Không có kênh hoạt động để đồng bộ.")

        now = timezone.now()
        history_since = now - datetime.timedelta(days=initial_days)
        manual_since = str(options.get("since") or "").strip()
        manual_until = str(options.get("until") or "").strip()
        force_history = bool(options.get("force_history"))
        request_id = str(options.get("request_id") or "").strip() or f"daily_{uuid.uuid4().hex[:10]}"
        channel_ids = [channel.id for channel in active_channels]
        existing_logs = {
            log.channel_id: log
            for log in ApiLog.objects.filter(request_id=request_id, channel_id__in=channel_ids)
        }
        missing_channels = [channel for channel in active_channels if channel.id not in existing_logs]
        queued_logs = {
            **existing_logs,
            **SyncEngine.queue_channels(missing_channels, request_id),
        }
        successes = 0

        for channel in active_channels:
            needs_initial_sync = force_history or channel.initial_sync_completed_at is None
            recent_since = now - datetime.timedelta(days=recent_days)
            since = manual_since or (history_since if needs_initial_sync else recent_since)
            until = manual_until or now

            # Post metrics are stock values (for example, a post published last
            # month can still receive new views today). Discover only recent
            # posts on routine runs, but refresh the metrics of every tracked
            # post in the reporting history so today's snapshot is complete.
            # Without this, only followers received a new daily value.
            snapshot_existing_since = manual_since or history_since

            success, message = SyncEngine.sync_channel(
                channel.id,
                request_id=request_id,
                since=since,
                until=until,
                follower_since=since,
                snapshot_existing_since=snapshot_existing_since,
                queued_log=queued_logs[channel.id],
            )
            status_label = "OK" if success else "ERROR"
            self.stdout.write(f"[{status_label}] {channel.name}: {message}")
            if success:
                successes += 1

        total = len(active_channels)
        if successes != total:
            raise CommandError(
                f"Đồng bộ hằng ngày chỉ thành công {successes}/{total} kênh."
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Đã lưu dữ liệu gần đây cho {successes}/{total} kênh."
            )
        )
