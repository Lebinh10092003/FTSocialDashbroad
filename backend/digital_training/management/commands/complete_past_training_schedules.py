from django.core.management.base import BaseCommand

from digital_training.completion_service import complete_past_training_schedules


class Command(BaseCommand):
    help = "Mark planned training and work-calendar entries as completed after they end."

    def handle(self, *args, **options):
        result = complete_past_training_schedules()
        self.stdout.write(self.style.SUCCESS(
            "Updated {total} past schedules: {sessions} training sessions, "
            "{customer_meetings} customer/work entries.".format(**result)
        ))
