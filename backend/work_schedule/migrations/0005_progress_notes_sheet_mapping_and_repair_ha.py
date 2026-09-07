from django.db import migrations, models


FT_SHEET_ROWS = [
    ("hanh@fermat.edu.vn", "2026-09-07", 1096, [
        "Quy chế tài chính",
        "Nội quy lao động",
        "Chốt hợp đồng và hóa đơn để phát hành THCS Nguyễn Du",
        "Làm lại bảng lương năm 2025",
        "Phối hợp Khánh Hà phát hành hợp đồng cho các đơn vị",
        "Hồ sơ thầu Giảng Võ",
        "Chốt triển khai hợp đồng THCS Nguyễn Du với KTT mới",
    ]),
    ("hanh@fermat.edu.vn", "2026-09-08", 1106, [
        "Chủ trì phối hợp VNC cung cấp hồ sơ cho họ",
        "Kiểm tra hồ sơ thành lập Viện Công nghệ số và Khảo thí",
        "Đăng ký 06 tài khoản AI cho THCS Giảng Võ",
    ]),
    ("hadk1@fermat.edu.vn", "2026-09-07", 1102, [
        "Phát hành hồ sơ THCS Ba Đình",
        "Phát hành hồ sơ TH Phúc Đồng",
        "Dự thảo hồ sơ THCS Xuân Phương",
        "Dự thảo hồ sơ Urenco Gia Lâm",
        "Dự thảo hồ sơ chị Tâm (Hoài Đức)",
    ]),
]

SHARED_EXAM_ROWS = [
    ("hanh@fermat.edu.vn", "2026-09-20", 1226, "REC-2818F2E8080B45E8-001125", "Trông thi Vòng loại quốc gia FIMO, đợt 1"),
    ("hanh@fermat.edu.vn", "2026-09-27", 1237, "REC-2818F2E8080B45E8-001136", "Trông thi Vòng loại quốc gia FIEO, đợt 1"),
    ("hadk1@fermat.edu.vn", "2026-09-20", 1232, "REC-2818F2E8080B45E8-001122", "Trông thi Vòng loại quốc gia FIMO, đợt 1"),
    ("hadk1@fermat.edu.vn", "2026-09-27", 1234, "REC-2818F2E8080B45E8-001133", "Trông thi Vòng loại quốc gia FIEO, đợt 1"),
]

PHONG_PROGRESS = [
    (1, "In GCN, Huy chương cho thí sinh kỳ thi SCO; In GCN hoàn thành khóa học cho các đơn vị đã hoàn thiện", "Ms Phương và Ms Liên đang trao đổi để trình ký quyết định in GCN"),
    (2, "Hoàn thành hồ sơ và trình Mr Thuận ký về SCO 26-27 Circle 1, WAICY, FIEO, FIMO.", "Hoàn thành"),
    (3, "Kiểm tra, sửa một số lỗi của phần mềm làm bài kiểm tra cuối khóa tập huấn", "Hoàn thành"),
    (4, "Tạo demo trình Lịch công tác cho phép tương tác với Sheet, trực quan lịch công tác cá nhân trên FT Workspace", "Hoàn thành"),
    (5, "Phối hợp Ms Phương chấm điểm các bài kiểm tra cuối khóa tập huấn của THCS Chu Văn An (Việt Hưng), THPT Khương Đình, TH Nguyễn Du", "Hiện còn trường Khương Đình"),
]


def repair_imported_schedules(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    ha_emails = ["hanh@fermat.edu.vn", "hadk1@fermat.edu.vn"]

    for target_email, work_date, sheet_row, titles in FT_SHEET_ROWS:
        for task_index, title in enumerate(titles, start=1):
            candidates = WorkItem.objects.filter(
                executor_id__in=ha_emails,
                work_date=work_date,
                title=title,
                description__startswith="Nhập từ Lịch công tác FT",
            ).order_by("pk")
            correct = candidates.filter(executor_id=target_email).first()
            wrong_rows = candidates.exclude(executor_id=target_email)
            item = correct or wrong_rows.first()
            if not item:
                continue
            if correct:
                wrong_rows.delete()
            elif item.executor_id != target_email:
                item.executor_id = target_email
            item.source_sheet_row = sheet_row
            item.source_task_index = task_index
            item.save(update_fields=["executor", "source_sheet_row", "source_task_index"])

    for email, work_date, sheet_row, record_id, title in SHARED_EXAM_ROWS:
        WorkItem.objects.filter(executor_id=email, work_date=work_date, title=title).update(
            source_sheet_row=sheet_row,
            source_task_index=1,
            source_record_id=record_id,
        )

    for task_index, title, progress_note in PHONG_PROGRESS:
        WorkItem.objects.filter(
            executor_id="phongnt@fermat.edu.vn",
            work_date="2026-09-07",
            title=title,
        ).update(
            progress_note=progress_note,
            source_sheet_row=1098,
            source_task_index=task_index,
            source_record_id="REC-2818F2E8080B45E8-001094",
        )

    for executor_id in ha_emails:
        dates = WorkItem.objects.filter(executor_id=executor_id).values_list("work_date", flat=True).distinct()
        for work_date in dates:
            rows = WorkItem.objects.filter(executor_id=executor_id, work_date=work_date).order_by(
                "daily_order", "start_time", "created_at", "pk"
            )
            for order, item in enumerate(rows, start=1):
                if item.daily_order != order:
                    WorkItem.objects.filter(pk=item.pk).update(daily_order=order)


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0004_import_ft_weeks_37_39")]

    operations = [
        migrations.AddField(
            model_name="workitem",
            name="progress_note",
            field=models.CharField(blank=True, default="", max_length=1000),
        ),
        migrations.AddField(
            model_name="workitem",
            name="source_record_id",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="workitem",
            name="source_sheet_row",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="workitem",
            name="source_task_index",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(repair_imported_schedules, migrations.RunPython.noop),
    ]
