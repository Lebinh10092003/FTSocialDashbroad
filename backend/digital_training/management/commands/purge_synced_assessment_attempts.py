from django.core.management.base import BaseCommand
from digital_training.assessment_lifecycle import run_assessment_lifecycle


class Command(BaseCommand):
    help = "Compatibility alias for the assessment-level retention lifecycle."

    def handle(self, *args, **options):
        result = run_assessment_lifecycle()
        self.stdout.write(self.style.SUCCESS(f"Assessment lifecycle complete: {result}"))
