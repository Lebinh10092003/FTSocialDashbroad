import json
import re
import unicodedata
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path

from django.db import migrations, models
from work_schedule.sheet_parser import assessment_notes, parse_sheet_tasks, status_from_note, training_end


IMPORT_DATE = date(2026, 9, 8)
SOURCE_DESCRIPTION = "Nhập từ Lịch công tác FT 2026 mới."
EMPLOYEE_EMAILS = {
    "EMP-0FA847B0": "dungpv@fermat.edu.vn",
    "EMP-198EA04B": "liennt@fermat.edu.vn",
    "EMP-AECADFA4": "hanh@fermat.edu.vn",
    "EMP-9864ED57": "binhlv@fermat.edu.vn",
    "EMP-AA0FCF6E": "phongnt@fermat.edu.vn",
    "EMP-564CB158": "phuongnt@fermat.edu.vn",
    "EMP-000A3BD2": "tienthm@fermat.edu.vn",
    "EMP-ABD98A8B": "sondc@fermat.edu.vn",
    "EMP-9EC1EEB6": "hadk1@fermat.edu.vn",
}


def _snapshot():
    path = Path(__file__).resolve().parents[1] / "data" / "ft_sheet_initial_snapshot.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _normalized(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _best_candidate(candidates, title, used_ids):
    available = [item for item in candidates if item.pk not in used_ids]
    if not available:
        return None
    target = _normalized(title)
    exact = next((item for item in available if _normalized(item.title) == target), None)
    if exact:
        return exact
    scored = [(SequenceMatcher(None, target, _normalized(item.title)).ratio(), item) for item in available]
    score, item = max(scored, key=lambda pair: pair[0])
    return item if score >= 0.72 else None


def _executor_for_row(UserProfile, row):
    email = EMPLOYEE_EMAILS.get(row["employee_id"])
    if email:
        return UserProfile.objects.filter(email=email, employment_status="ACTIVE").first()
    display_name = re.sub(r"^\s*\d+\s*[.)]?\s*", "", row.get("person", "")).strip()
    matches = list(UserProfile.objects.filter(name__iendswith=display_name, employment_status="ACTIVE")[:2])
    return matches[0] if len(matches) == 1 else None


def _sync_training(TrainingSession, item, title, work_date, start_time, is_training):
    if not is_training:
        return
    end_time = training_end(start_time)
    if item.training_session_id:
        TrainingSession.objects.filter(pk=item.training_session_id).update(
            title=title,
            session_date=work_date,
            start_time=start_time,
            end_time=end_time,
            category="Tập huấn",
            contents=[title],
            status="completed" if item.status == "completed" else "planned",
            staff_name=item.executor.name or item.executor.email,
            instructor_name=item.executor.name or item.executor.email,
        )
        return
    session = TrainingSession.objects.create(
        title=title,
        session_date=work_date,
        start_time=start_time,
        end_time=end_time,
        category="Tập huấn",
        contents=[title],
        status="completed" if item.status == "completed" else "planned",
        staff_name=item.executor.name or item.executor.email,
        instructor_name=item.executor.name or item.executor.email,
    )
    item.training_session_id = session.pk
    item.save(update_fields=["training_session"])


def reconcile_snapshot(apps, schema_editor):
    UserProfile = apps.get_model("authentication", "UserProfile")
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    TrainingSession = apps.get_model("digital_training", "TrainingSession")
    data = _snapshot()
    desired_groups = set()
    touched_groups = set()

    for row in data["rows"]:
        executor = _executor_for_row(UserProfile, row)
        if not executor:
            continue
        work_date = datetime.strptime(row["date"], "%d/%m/%Y").date()
        parsed = parse_sheet_tasks(row["tasks"])
        notes = assessment_notes(row.get("self_assessment", ""), len(parsed))
        desired_groups.add((executor.email, work_date))
        touched_groups.add((executor.email, work_date))
        imported = list(WorkItem.objects.filter(
            executor=executor,
            work_date=work_date,
            description__startswith="Nhập từ Lịch công tác FT",
        ).order_by("daily_order", "pk"))
        used_ids = set()

        for task_index, parsed_task in enumerate(parsed, start=1):
            note = notes[task_index - 1] if task_index <= len(notes) else ""
            source_match = WorkItem.objects.filter(
                executor=executor,
                source_sheet_row=row["row"],
                source_task_index=task_index,
            ).first()
            item = source_match or _best_candidate(imported, parsed_task.title, used_ids)
            status = status_from_note(note, work_date > IMPORT_DATE)
            is_training = executor.email == "liennt@fermat.edu.vn" and "tập huấn" in parsed_task.title.lower()
            end_time = training_end(parsed_task.start_time) if is_training else None
            if item:
                item.title = parsed_task.title
                item.description = SOURCE_DESCRIPTION
                item.progress_note = note
                item.work_date = work_date
                item.start_time = parsed_task.start_time
                item.end_time = end_time
                item.status = status
                item.priority = "medium"
                item.label = "Tập huấn" if is_training else "Công việc"
                item.daily_order = task_index
                item.source_sheet_row = row["row"]
                item.source_task_index = task_index
                item.source_record_id = row.get("record_id", "")
                item.save()
            else:
                item = WorkItem.objects.create(
                    creator=executor,
                    executor=executor,
                    title=parsed_task.title,
                    description=SOURCE_DESCRIPTION,
                    progress_note=note,
                    work_date=work_date,
                    start_time=parsed_task.start_time,
                    end_time=end_time,
                    status=status,
                    priority="medium",
                    label="Tập huấn" if is_training else "Công việc",
                    daily_order=task_index,
                    source_sheet_row=row["row"],
                    source_task_index=task_index,
                    source_record_id=row.get("record_id", ""),
                )
            used_ids.add(item.pk)
            _sync_training(TrainingSession, item, parsed_task.title, work_date, parsed_task.start_time, is_training)

        stale = [item for item in imported if item.pk not in used_ids]
        for item in stale:
            if item.training_session_id:
                TrainingSession.objects.filter(pk=item.training_session_id).delete()
            item.delete()

    # The previous demo migration attached Mr Dũng to every imported task of two
    # direct reports. A reporting hierarchy must not imply task management.
    dung = UserProfile.objects.filter(email="dungpv@fermat.edu.vn").first()
    if dung:
        for email, work_date in desired_groups:
            if email not in {"phongnt@fermat.edu.vn", "phuongnt@fermat.edu.vn"}:
                continue
            for item in WorkItem.objects.filter(
                executor_id=email,
                work_date=work_date,
                description__startswith="Nhập từ Lịch công tác FT",
            ):
                item.managers.remove(dung)

    for email, work_date in touched_groups:
        rows = WorkItem.objects.filter(executor_id=email, work_date=work_date).order_by(
            "daily_order", "start_time", "created_at", "pk"
        )
        for order, item in enumerate(rows, start=1):
            if item.daily_order != order:
                WorkItem.objects.filter(pk=item.pk).update(daily_order=order)


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0005_progress_notes_sheet_mapping_and_repair_ha")]

    operations = [
        migrations.AlterField(
            model_name="workitem",
            name="title",
            field=models.CharField(max_length=1000),
        ),
        migrations.RunPython(reconcile_snapshot, migrations.RunPython.noop),
    ]
