import json

from django.core.management.base import BaseCommand

from digital_training.assessment_lifecycle import run_assessment_lifecycle


class Command(BaseCommand):
    help = "Emit assessment warnings, verify Sheet backups and purge expired data."

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(run_assessment_lifecycle(), ensure_ascii=False))
