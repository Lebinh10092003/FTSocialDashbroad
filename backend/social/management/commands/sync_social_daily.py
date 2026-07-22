import datetime
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from social.models import ApiLog, Channel
from social.sync import SyncEngine


class Command(BaseCommand):
    help = (
        "Refresh recent social posts and follower snapshots. The first run "
        "backfills one year of daily follower history."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--backfill-days",
            type=int,
            default=365,
            help="Initial follower-history backfill window (default: 365 days).",
        )
        parser.add_argument(
            "--recent-days",
            type=int,
            default=7,
            help="Recent post and follower refresh window after the first run (default: 7 days).",
        )
        parser.add_argument(
            "--request-id",
            default="",
            help="Existing background sync request identifier, if one was pre-queued.",
        )

    def handle(self, *args, **options):
        backfill_days = options["backfill_days"]
        recent_days = options["recent_days"]
        if not 1 <= recent_days <= backfill_days:
            raise CommandError("--recent-days must be between 1 and --backfill-days.")
        if backfill_days > 3650:
            raise CommandError("--backfill-days cannot exceed 3650 days.")

        active_channels = list(Channel.objects.filter(status="active").order_by("name"))
        if not active_channels:
            raise CommandError("Không có kênh hoạt động để đồng bộ.")

        now = timezone.now()
        history_since = now - datetime.timedelta(days=backfill_days)
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
            if SyncEngine.is_request_cancelled(request_id):
                self.stdout.write(self.style.WARNING("Đồng bộ đã được hủy."))
                return

            has_follower_history = channel.follower_history_loaded_at is not None
            recent_since = now - datetime.timedelta(days=recent_days)
            follower_since = recent_since if has_follower_history else history_since

            success, message = SyncEngine.sync_channel(
                channel.id,
                request_id=request_id,
                since=recent_since,
                until=now,
                follower_since=follower_since,
                queued_log=queued_logs[channel.id],
            )
            status_label = "OK" if success else "ERROR"
            self.stdout.write(f"[{status_label}] {channel.name}: {message}")
            if success:
                successes += 1

            if SyncEngine.is_request_cancelled(request_id):
                self.stdout.write(self.style.WARNING("Đồng bộ đã được hủy."))
                return

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
