from django.core.management.base import BaseCommand, CommandError

from authentication.monthly_sheets import remind_missing_monthly_sheet_links


class Command(BaseCommand):
    help = "Create idempotent monthly reminders when Công ca or Lịch làm việc sheet links are missing."

    def add_arguments(self, parser):
        parser.add_argument("--month", default=None, help="Month in YYYY-MM format; defaults to the current local month.")

    def handle(self, *args, **options):
        try:
            result = remind_missing_monthly_sheet_links(options.get("month"))
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(
            f"Month {result['month']}: missing={','.join(result['missing']) or 'none'}, notifications={len(result['created'])}, recipients={len(result['recipients'])}"
        ))
