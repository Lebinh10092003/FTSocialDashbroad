from datetime import datetime, time, timedelta

from django.db import migrations
from django.db.models import Max


ROWS = [
    ("dungpv@fermat.edu.vn", "2026-09-07", [
        "Hiện đang chậm muộn BC cá nhân KQ công tác tuần 36, NV tuần 37 (dưới 01 trang A4), hoàn thành và lưu BNDC trước 15h30 ngày 07/9.",
        "Cập nhật HĐ với WAICY, SCO, FIMO, FIEO và gửi Mr Thuận ký.",
    ]),
    ("liennt@fermat.edu.vn", "2026-09-07", [
        "Chuẩn bị nội dung tập huấn GCE1 cho THCS Nguyễn Du",
        "Chỉ đạo NV tạo 200 TK cho HS tham gia lớp học số THCS Giảng Võ",
        "Góp ý và hoàn thiện mẫu GCN của 199 học viên với 03 đơn vị, CC cho Mr Thuận qua email.",
        ("Tập huấn GCE1 THCS Nguyễn Du", "17:30", True),
        "Tư vấn khách hàng",
    ]),
    ("hanh@fermat.edu.vn", "2026-09-07", [
        "Quy chế tài chính", "Nội quy lao động", "Chốt hợp đồng và hóa đơn để phát hành THCS Nguyễn Du",
        "Làm lại bảng lương năm 2025", "Phối hợp Khánh Hà phát hành hợp đồng cho các đơn vị",
        "Hồ sơ thầu Giảng Võ", "Chốt triển khai hợp đồng THCS Nguyễn Du với KTT mới",
    ]),
    ("binhlv@fermat.edu.vn", "2026-09-07", [
        "Đăng ký 5 tài khoản AI cho trường MN Đại Mỗ",
        "Đánh giá lại BNDC (về cấu trúc, dữ liệu, thư mục, cách sử dụng, đánh giá xem có cần tập huấn lại không) của THCS Giảng Võ (sau sáp nhập) và báo cáo Ms Liên.",
        "List danh sách dự kiến xóa dữ liệu trên BNDC badinhedu.vn và ước dữ liệu sẽ xóa, gửi BC trước khi làm qua email cho BLĐ.",
        "List các đơn vị dự kiến xóa dữ liệu, dung lượng dữ liệu từng đơn vị, dữ liệu tổng trên badinhedu.vn.",
        "Cài đặt Chromebook cho PHHS THCS Nguyễn Du mang đến công ty",
        "Setting lại lớp học số của THCS Nguyễn Du, tạo danh sách email cho học sinh",
        ("Hỗ trợ tập huấn Lớp học số tại THCS Nguyễn Du", "14:00", True),
    ]),
    ("phongnt@fermat.edu.vn", "2026-09-07", [
        "In GCN, Huy chương cho thí sinh kỳ thi SCO; In GCN hoàn thành khóa học cho các đơn vị đã hoàn thiện",
        "Hoàn thành hồ sơ và trình Mr Thuận ký về SCO 26-27 Circle 1, WAICY, FIEO, FIMO.",
        "Kiểm tra, sửa một số lỗi của phần mềm làm bài kiểm tra cuối khóa tập huấn",
        "Tạo demo trình Lịch công tác cho phép tương tác với Sheet, trực quan lịch công tác cá nhân trên FT Workspace",
        "Phối hợp Ms Phương chấm điểm các bài kiểm tra cuối khóa tập huấn của THCS Chu Văn An (Việt Hưng), THPT Khương Đình, TH Nguyễn Du",
        "Hiện đang chậm muộn BC cá nhân KQ công tác tuần 36, NV tuần 37 (dưới 01 trang A4), hoàn thành và lưu BNDC trước 15h30 ngày 07/9.",
    ]),
    ("phuongnt@fermat.edu.vn", "2026-09-07", [
        "Đăng bài cho Group One lesson A Day; chăm sóc fanpage FT, Group Giáo dục và AI; lưu ý chia sẻ lên các nhóm nhiều thành viên.",
        "Gửi tài liệu sau tập huấn cho MN Đại Mỗ", "Chăm sóc khách hàng cũ và mới", "Chấm bài TH Nguyễn Du",
        "Soạn email tuyên truyền 7 cuộc thi sắp và đang triển khai", "Đăng bài cho FIMO, FIEO, SIBO và SIPhO",
    ]),
    ("tienthm@fermat.edu.vn", "2026-09-07", [
        "Giảng dạy tại trường Cao đẳng Công thương Quốc tế môn Hệ quản trị CSDL SQL Server, Thiết kế UI/UX (việc cá nhân cả ngày).",
        "Tìm kiếm, lựa chọn, báo cáo lớp học liên quan đến chuẩn hóa, làm sạch, tích hợp dữ liệu; dashboard và KPI; kiểm soát chất lượng AI Agent; ứng dụng vào bài toán thực tế của FT cho BLĐ.",
        "Check email về Google Chat và Zalo để tham mưu BLĐ dùng hệ thống nào.",
    ]),
    ("sondc@fermat.edu.vn", "2026-09-07", [
        "Báo cáo và bàn giao SuperApp (App Cảnh báo an toàn và xử lý sự cố) đến THCS Giảng Võ.",
        "Thêm 200 TK cho THCS Giảng Võ", "Sửa lại logic App Cảnh báo An toàn và Xử lý Sự cố theo đề xuất của Ms Liên",
        "Sửa lịch FT New", "Viết báo cáo vấn đề mới phát sinh SuperApp",
    ]),
    ("hadk1@fermat.edu.vn", "2026-09-07", [
        "Phát hành hồ sơ THCS Ba Đình", "Phát hành hồ sơ TH Phúc Đồng", "Dự thảo hồ sơ THCS Xuân Phương",
        "Dự thảo hồ sơ Urenco Gia Lâm", "Dự thảo hồ sơ chị Tâm (Hoài Đức)",
    ]),
    ("dungpv@fermat.edu.vn", "2026-09-08", [
        "Chốt hồ sơ FIMO, FIEO theo phương án anh Thuận nhất trí.",
        "Chốt đề mẫu từ 1-9 FIMO, FIEO (thay đổi về thời hạn có thể dẫn đến thay đổi về cấu trúc đề).",
    ]),
    ("liennt@fermat.edu.vn", "2026-09-08", [("Tập huấn GCE1 B2 THCS Nguyễn Du", "17:30", True)]),
    ("hanh@fermat.edu.vn", "2026-09-08", [
        "Chủ trì phối hợp VNC cung cấp hồ sơ cho họ", "Kiểm tra hồ sơ thành lập Viện Công nghệ số và Khảo thí",
        "Đăng ký 06 tài khoản AI cho THCS Giảng Võ",
    ]),
    ("phuongnt@fermat.edu.vn", "2026-09-08", ["Đăng bài cho Group One lesson A Day; chăm sóc fanpage FT, Group Giáo dục và AI; lưu ý chia sẻ lên các nhóm nhiều thành viên."]),
    ("tienthm@fermat.edu.vn", "2026-09-08", [
        "Hoàn thiện Đề án xây dựng hệ thống AI Agent cho FermatTech",
        "Nghiên cứu về nội dung tập huấn cho tổ CĐS Cộng đồng ở UBX Phúc Thịnh",
        "Nghiên cứu và tạo trợ lý GEM cho Phòng Kinh tế Hạ tầng Phúc Thịnh",
        ("Tham gia tập huấn GCE1 B2 THCS Nguyễn Du cùng Ms Liên", "17:30", False),
    ]),
    ("dungpv@fermat.edu.vn", "2026-09-09", ["Điều chỉnh phương án truyền thông FIMO và FIEO", "Rà soát các vấn đề đăng ký Vòng khu vực AYSBC"]),
    ("liennt@fermat.edu.vn", "2026-09-09", [("Tập huấn B1 MN Từ Liêm 2", "16:30", True)]),
    ("phuongnt@fermat.edu.vn", "2026-09-09", ["Đăng bài cho Group One lesson A Day; chăm sóc fanpage FT, Group Giáo dục và AI; lưu ý chia sẻ lên các nhóm nhiều thành viên."]),
    ("tienthm@fermat.edu.vn", "2026-09-09", ["Giảng dạy tại trường Cao đẳng Công thương Quốc tế môn Hệ quản trị CSDL SQL Server, Thiết kế UI/UX (việc cá nhân cả ngày)."]),
    ("dungpv@fermat.edu.vn", "2026-09-10", ["Chốt các vấn đề về truyền thông: logo, nhận diện thương hiệu, Profile & Catalogue", "Chuẩn bị hệ thống truyền thông phục vụ triển khai các Cuộc thi"]),
    ("liennt@fermat.edu.vn", "2026-09-10", [("Tập huấn B2 THCS Ba Đình (sau sáp nhập)", "14:00", True), ("Tập huấn B2 MN Từ Liêm 2", "17:00", True)]),
    ("phongnt@fermat.edu.vn", "2026-09-10", ["In GCN, Huy chương cho thí sinh kỳ thi SCO."]),
    ("phuongnt@fermat.edu.vn", "2026-09-10", ["Đăng bài cho Group One lesson A Day; chăm sóc fanpage FT, Group Giáo dục và AI; lưu ý chia sẻ lên các nhóm nhiều thành viên."]),
    ("tienthm@fermat.edu.vn", "2026-09-10", [("Tham gia tập huấn B2 THCS Ba Đình (sau sáp nhập) cùng Ms Liên", "14:00", False)]),
    ("dungpv@fermat.edu.vn", "2026-09-11", ["Hết hạn đăng ký tham dự Vòng khu vực AYSBC, phối hợp Mr Phong liên lạc AYSBC nhận danh sách"]),
    ("liennt@fermat.edu.vn", "2026-09-11", [("Tập huấn B2 TH Kim Đồng", "17:00", True)]),
    ("phongnt@fermat.edu.vn", "2026-09-11", ["Gửi GCN, huy chương cho thí sinh SCO Cycle 1 2026-2027"]),
    ("phuongnt@fermat.edu.vn", "2026-09-11", ["Đăng bài cho Group One lesson A Day; chăm sóc fanpage FT, Group Giáo dục và AI; lưu ý chia sẻ lên các nhóm nhiều thành viên."]),
    ("tienthm@fermat.edu.vn", "2026-09-11", [("Tham gia tập huấn B2 TH Kim Đồng cùng Ms Liên", "17:00", False)]),
    ("liennt@fermat.edu.vn", "2026-09-12", [("Tập huấn B3, B4 TH Kim Đồng", "09:00", True)]),
    ("tienthm@fermat.edu.vn", "2026-09-12", [("Tham gia tập huấn B3, B4 TH Kim Đồng cùng Ms Liên", "09:00", False)]),
    ("liennt@fermat.edu.vn", "2026-09-13", [("Tập huấn B3, B4 MN Đại Mỗ", "09:00", True)]),
    ("tienthm@fermat.edu.vn", "2026-09-13", [("Tham gia tập huấn B3, B4 MN Đại Mỗ cùng Ms Liên", "09:00", False)]),
    ("liennt@fermat.edu.vn", "2026-09-14", [("Tập huấn B3 MN Từ Liêm 2", "09:00", True)]),
    ("liennt@fermat.edu.vn", "2026-09-15", [("Tập huấn B1 TH Trung Văn", "17:00", True)]),
    ("liennt@fermat.edu.vn", "2026-09-16", [("Tập huấn B2 TH Trung Văn", "17:00", True)]),
    ("liennt@fermat.edu.vn", "2026-09-17", [("Tập huấn B3 TH Trung Văn", "08:00", True)]),
    ("dungpv@fermat.edu.vn", "2026-09-18", ["Phối hợp, phân công nhân sự Team khảo thí chuẩn bị, hoàn thiện đề Vòng loại Quốc gia SIAIO - SCO cycle 1 2026-2027"]),
]

FIMO_STAFF = [
    "dungpv@fermat.edu.vn", "hanh@fermat.edu.vn", "binhlv@fermat.edu.vn", "phongnt@fermat.edu.vn",
    "phuongnt@fermat.edu.vn", "tienthm@fermat.edu.vn", "sondc@fermat.edu.vn", "hadk1@fermat.edu.vn",
]
FIEO_STAFF = FIMO_STAFF


def import_schedules(apps, schema_editor):
    UserProfile = apps.get_model("authentication", "UserProfile")
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    TrainingSession = apps.get_model("digital_training", "TrainingSession")
    manager = UserProfile.objects.filter(email="dungpv@fermat.edu.vn").first()
    if manager:
        UserProfile.objects.filter(
            email__in=["phongnt@fermat.edu.vn", "phuongnt@fermat.edu.vn"]
        ).update(manager=manager)

    rows = list(ROWS)
    rows.append(("liennt@fermat.edu.vn", "2026-09-20", [("Tập huấn B5, B6 MN Đại Mỗ", "09:00", True)]))
    rows.extend((email, "2026-09-20", ["Trông thi Vòng loại quốc gia FIMO, đợt 1"]) for email in FIMO_STAFF)
    rows.append(("liennt@fermat.edu.vn", "2026-09-27", [("Tập huấn B7, B8 MN Đại Mỗ", "09:00", True)]))
    rows.extend((email, "2026-09-27", ["Trông thi Vòng loại quốc gia FIEO, đợt 1"]) for email in FIEO_STAFF)

    for email, raw_date, tasks in rows:
        executor = UserProfile.objects.filter(email=email, employment_status="ACTIVE").first()
        if not executor:
            continue
        work_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        for task_index, raw_task in enumerate(tasks, start=1):
            if isinstance(raw_task, tuple):
                title, raw_start, sync_training = raw_task
                start_time = datetime.strptime(raw_start, "%H:%M").time()
                end_time = (datetime.combine(work_date, start_time) + timedelta(hours=3)).time()
            else:
                title, sync_training = raw_task, False
                start_time = end_time = None
            if WorkItem.objects.filter(executor=executor, work_date=work_date, title=title).exists():
                continue
            if email == "phongnt@fermat.edu.vn" and raw_date == "2026-09-07" and WorkItem.objects.filter(
                executor=executor, work_date=work_date, daily_order=task_index
            ).exists():
                continue
            order = (WorkItem.objects.filter(executor=executor, work_date=work_date).aggregate(value=Max("daily_order"))["value"] or 0) + 1
            item = WorkItem.objects.create(
                creator=executor,
                executor=executor,
                title=title,
                description="Nhập từ Lịch công tác FT 2026 mới.",
                work_date=work_date,
                start_time=start_time,
                end_time=end_time,
                status="todo",
                priority="medium",
                label="Tập huấn" if sync_training else "Công việc",
                daily_order=order,
            )
            if manager and email in {"phongnt@fermat.edu.vn", "phuongnt@fermat.edu.vn"}:
                item.managers.add(manager)
            if sync_training:
                session = TrainingSession.objects.create(
                    title=title,
                    session_date=work_date,
                    start_time=start_time,
                    end_time=end_time,
                    category="Tập huấn",
                    contents=[title],
                    status="planned",
                    staff_name=executor.name or executor.email,
                    instructor_name=executor.name or executor.email,
                )
                item.training_session = session
                item.save(update_fields=["training_session"])


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0013_provision_mr_dung"),
        ("work_schedule", "0003_workitem_training_session"),
    ]

    operations = [migrations.RunPython(import_schedules, migrations.RunPython.noop)]
