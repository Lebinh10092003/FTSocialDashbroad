from django.core.management.base import BaseCommand, CommandError

from work_schedule.sheet_sync import initial_two_way_sync, sync_to_sheet


class Command(BaseCommand):
    help = "Đồng bộ hai chiều lịch làm việc với Lịch công tác FT."

    def add_arguments(self, parser):
        parser.add_argument("--direction", choices=["both", "to-sheet"], default="to-sheet")
        parser.add_argument("--force", action="store_true")

    def handle(self, *args, **options):
        try:
            if options["direction"] == "both":
                result = initial_two_way_sync()
            else:
                result = sync_to_sheet(force=options["force"])
        except Exception as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(str(result)))
