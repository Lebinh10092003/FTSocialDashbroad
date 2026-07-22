import datetime
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from social.models import Channel, Post
from social.sync import SyncEngine


class Command(BaseCommand):
    help = (
        "Discover recent social posts and persist one metrics snapshot per post "
        "for the configured rolling window."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--backfill-days",
            type=int,
            default=365,
            help="Initial backfill and daily snapshot window (default: 365 days).",
        )
        parser.add_argument(
            "--recent-days",
            type=int,
            default=365,
            help="Post discovery window after the initial backfill (default: 365 days).",
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
        snapshot_since = now - datetime.timedelta(days=backfill_days)
        request_id = f"daily_{uuid.uuid4().hex[:10]}"
        queued_logs = SyncEngine.queue_channels(active_channels, request_id)
        successes = 0

        for channel in active_channels:
            has_existing_data = (
                channel.last_sync_at is not None
                and Post.objects.filter(channel_id=channel.id, is_deleted=False).exists()
            )
            discovery_days = recent_days if has_existing_data else backfill_days
            discovery_since = now - datetime.timedelta(days=discovery_days)

            success, message = SyncEngine.sync_channel(
                channel.id,
                request_id=request_id,
                since=discovery_since,
                until=now,
                snapshot_existing_since=snapshot_since if has_existing_data else None,
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
                f"Đã lưu snapshot hằng ngày cho {successes}/{total} kênh."
            )
        )
