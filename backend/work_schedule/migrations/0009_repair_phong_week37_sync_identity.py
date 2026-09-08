import uuid
from datetime import date

from django.db import migrations


TASKS = [
    (1, "In GCN, Huy chương cho thí sinh kỳ thi SCO; In GCN hoàn thành khóa học cho các đơn vị đã hoàn thiện", "Ms Phương và Ms Liên đang trao đổi để trình ký quyết định in GCN", "doing"),
    (2, "Hoàn thành hồ sơ và trình Mr Thuận ký về SCO 26-27 Circle 1, WAICY, FIEO, FIMO.", "", "completed"),
    (3, "Kiểm tra, sửa một số lỗi của phần mềm làm bài kiểm tra cuối khóa tập huấn", "", "completed"),
    (4, 'Tạo demo trình "Lịch công tác" cho phép tương tác vưới sheet, trực quan lịch công tác cá nhân trên FTWorkspace', "", "completed"),
    (5, "Phối hợp Ms Phương, chấm điểm các bài kiểm tra cuối khóa tập huấn của: THCS Chu Văn An (Việt Hưng), THPT Khương Đình, TH Nguyễn Du", "Hiện còn trường Khương Đình", "doing"),
    (6, "Hiện đang chậm muộn BC cá nhân KQ công tác tuần 36, NV tuần 37 (dưới 01 trang A4), hoàn thành và lưu BNDC trước 15h30 ngày 07/9.", "", "doing"),
]
BAD_DUPLICATE_UIDS = [
    "417d01aa-1433-4628-a52d-3432e99f7999",
    "7a9c42e3-f25f-4e22-96f1-158bc9da0b6b",
    "64e6da77-95a5-4d47-8c1f-cf60b72aff4c",
    "854f9e41-0450-4b22-8275-8fad68f97e16",
    "c350f182-8acd-4085-af30-cba6d348bf11",
    "06203e57-2443-490c-98aa-c1ed0a926eb1",
]


def repair(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    UserProfile = apps.get_model("authentication", "UserProfile")
    WorkItem.objects.filter(sync_uid__in=BAD_DUPLICATE_UIDS).delete()
    executor = UserProfile.objects.filter(email="phongnt@fermat.edu.vn").first()
    if not executor:
        return
    for index, title, progress_note, status in TASKS:
        sync_uid = uuid.UUID(f"6ae71379-0000-5000-8000-{1098:06x}{index:06x}")
        defaults = {
            "executor": executor,
            "work_date": date(2026, 9, 7),
            "title": title,
            "progress_note": progress_note,
            "status": status,
            "daily_order": index,
            "source_sheet_row": 1098,
            "source_task_index": index,
            "source_record_id": "REC-2818F2E8080B45E8-001094",
            "source_sync_hash": "",
        }
        item = WorkItem.objects.filter(sync_uid=sync_uid).first()
        if item:
            for field, value in defaults.items():
                setattr(item, field, value)
            item.save()
        else:
            WorkItem.objects.create(sync_uid=sync_uid, creator=executor, **defaults)


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0008_remove_initial_sync_duplicates")]
    operations = [migrations.RunPython(repair, migrations.RunPython.noop)]
