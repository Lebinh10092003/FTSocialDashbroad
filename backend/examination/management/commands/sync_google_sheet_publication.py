from django.core.management.base import BaseCommand, CommandError

from examination.models import ExaminationSheetPublication
from examination.sheet_publication import sync_publication
from examination.views import persisted_partners


class Command(BaseCommand):
    help = 'Publish Examination data to configured Google Sheet workbooks by academic year.'

    def add_arguments(self, parser):
        parser.add_argument('--academic-year', action='append', dest='academic_years', default=[])
        parser.add_argument('--session-id', action='append', dest='session_ids', default=[])
        parser.add_argument('--partners-only', action='store_true')

    def handle(self, *args, **options):
        publications = ExaminationSheetPublication.objects.filter(enabled=True).exclude(spreadsheet_url='').order_by('academic_year')
        academic_years = [str(value).strip() for value in options['academic_years'] if str(value).strip()]
        if academic_years:
            publications = publications.filter(academic_year__in=academic_years)
        publications = list(publications)
        if not publications:
            self.stdout.write(self.style.WARNING('No enabled Google Sheet publication is configured.'))
            return
        partners_only = options['partners_only']
        for publication in publications:
            try:
                result = sync_publication(
                    publication,
                    persisted_partners(),
                    session_ids=options['session_ids'] or None,
                    include_summary=not partners_only and not options['session_ids'],
                    include_partners=partners_only or not options['session_ids'],
                )
            except Exception as exc:
                publication.last_status = 'failed'
                publication.last_error = str(exc)
                publication.save(update_fields=['last_status', 'last_error', 'updated_at'])
                raise CommandError(f'{publication.academic_year}: {exc}') from exc
            self.stdout.write(self.style.SUCCESS(
                f"{publication.academic_year}: published {result['sessions']} sessions and {result['partners']} partners."
            ))