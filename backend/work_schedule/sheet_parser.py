import re
from dataclasses import dataclass
from datetime import datetime, time, timedelta


NUMBERED_LINE = re.compile(r"^\s*(\d{1,3})\s*[.,)]\s*(.*?)(?:\s*)$")
LEADING_TIME = re.compile(r"^\s*(\d{1,2})(?:[:hH])(\d{2})\s*:?[ ]*(.+)$", re.DOTALL)


@dataclass(frozen=True)
class ParsedSheetTask:
    source_number: int
    title: str
    start_time: time | None


def split_numbered_tasks(value: str) -> list[tuple[int, str]]:
    """Split a Sheet cell into tasks while retaining wrapped continuation lines.

    Sheet numbers are treated as visual markers only. Duplicate or skipped numbers
    are accepted and occurrence order remains authoritative.
    """
    entries: list[tuple[int, list[str]]] = []
    for raw_line in str(value or "").replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        match = NUMBERED_LINE.match(line)
        if match and match.group(2).strip():
            entries.append((int(match.group(1)), [match.group(2).strip()]))
        elif entries:
            entries[-1][1].append(line)
        else:
            entries.append((1, [line]))
    return [(number, "\n".join(parts).strip()) for number, parts in entries if "\n".join(parts).strip()]


def parse_sheet_tasks(value: str) -> list[ParsedSheetTask]:
    result: list[ParsedSheetTask] = []
    for number, raw_title in split_numbered_tasks(value):
        start = None
        title = raw_title.strip().rstrip(";").strip()
        match = LEADING_TIME.match(title)
        if match:
            hour, minute = int(match.group(1)), int(match.group(2))
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                start = time(hour, minute)
                title = match.group(3).strip().rstrip(";").strip()
        result.append(ParsedSheetTask(number, title, start))
    return result


def assessment_notes(value: str, task_count: int) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return [""] * task_count
    if NUMBERED_LINE.match(raw.splitlines()[0].strip()):
        entries: list[tuple[int, list[str]]] = []
        for raw_line in raw.replace("\r\n", "\n").split("\n"):
            line = raw_line.strip()
            match = NUMBERED_LINE.match(line)
            if match:
                entries.append((int(match.group(1)), [match.group(2).strip()]))
            elif line and entries:
                entries[-1][1].append(line)
        notes = [""] * task_count
        fallback = 0
        for number, parts in entries:
            note = "\n".join(parts).strip()
            if 1 <= number <= task_count and not notes[number - 1]:
                notes[number - 1] = note
                continue
            while fallback < task_count and notes[fallback]:
                fallback += 1
            if fallback < task_count:
                notes[fallback] = note
        return notes
    return [raw] * task_count


def status_from_note(note: str, is_future: bool) -> str:
    normalized = " ".join(str(note or "").strip().lower().split())
    if normalized in {"hoàn thành", "xong", "đã hoàn thành"}:
        return "completed"
    if normalized in {"cần làm", "chưa làm"}:
        return "todo"
    if normalized in {"đang làm", "đang thực hiện"} or normalized:
        return "doing"
    return "todo" if is_future else "doing"


def training_end(start: time | None) -> time | None:
    if not start:
        return None
    return (datetime.combine(datetime.min.date(), start) + timedelta(hours=3)).time()
