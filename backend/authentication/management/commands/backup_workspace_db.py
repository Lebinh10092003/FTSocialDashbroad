"""Create an online SQLite backup before a production deployment."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


class Command(BaseCommand):
    help = (
        "Back up the configured SQLite database safely. If DJANGO_DB_PATH points "
        "outside backend/ and that file does not exist yet, migrate the existing "
        "backend/db.sqlite3 to that durable location first."
    )

    def add_arguments(self, parser):
        parser.add_argument("--destination", required=True, help="Directory that stores SQLite backups.")
        parser.add_argument("--keep", type=int, default=30, help="Number of newest backups to keep (default: 30).")

    @staticmethod
    def _online_copy(source: Path, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        source_uri = f"file:{source.resolve().as_posix()}?mode=ro"
        source_connection = sqlite3.connect(source_uri, uri=True)
        target_connection = sqlite3.connect(target)
        try:
            source_connection.backup(target_connection)
        finally:
            target_connection.close()
            source_connection.close()

    def handle(self, *args, **options):
        keep = options["keep"]
        if keep < 1:
            raise CommandError("--keep must be at least 1.")

        database_name = str(settings.DATABASES["default"]["NAME"])
        if database_name == ":memory:":
            self.stdout.write("SQLite backup skipped for an in-memory database.")
            return

        configured_database = Path(database_name).expanduser()
        if not configured_database.is_absolute():
            configured_database = configured_database.resolve()
        legacy_database = (Path(settings.BASE_DIR) / "db.sqlite3").resolve()

        # One-time safe migration from the legacy in-repository SQLite location.
        if configured_database != legacy_database and not configured_database.exists() and legacy_database.exists():
            self._online_copy(legacy_database, configured_database)
            self.stdout.write(self.style.SUCCESS(
                f"Migrated existing SQLite data to durable path: {configured_database}"
            ))

        if not configured_database.exists():
            self.stdout.write("No SQLite database exists yet; backup skipped before initial migration.")
            return

        destination = Path(options["destination"]).expanduser()
        destination.mkdir(parents=True, exist_ok=True)
        timestamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
        target = destination / f"workspace-{timestamp}.sqlite3"
        self._online_copy(configured_database, target)

        backups = sorted(destination.glob("workspace-*.sqlite3"), key=lambda item: item.stat().st_mtime, reverse=True)
        for outdated_backup in backups[keep:]:
            outdated_backup.unlink()

        self.stdout.write(self.style.SUCCESS(f"SQLite backup created: {target}"))
