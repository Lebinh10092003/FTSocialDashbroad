from datetime import date

from django.db import migrations


def seed_training_tracking(apps, schema_editor):
    Partner = apps.get_model("digital_training", "TrainingPartner")
    TrainingClass = apps.get_model("digital_training", "TrainingClass")
    Session = apps.get_model("digital_training", "TrainingSession")

    # Operational register transcribed from the supplied partner-training spreadsheet.
    rows = [
        ("UBP Bộ Đề - VHXH", "Khối kiến", 4, [], "Lớp/nhóm chưa có lịch buổi học."),
        ("UBP Bộ Đề - VHXH", "Lớp 3", 5, [(1, "2026-05-04"), (2, "2026-05-04"), (3, "2026-05-05"), (4, "2026-05-13"), (5, "2026-05-15")], "Ban VHXH, HĐND & UBND, Trung tâm VH-TT, Trung tâm y tế Bộ Đề."),
        ("UBP Bộ Đề - VHXH", "Lớp 2", 5, [(1, "2026-04-25"), (2, "2026-05-07"), (3, "2026-05-11"), (4, "2026-05-21"), (5, "2026-05-27")], "VPĐU, Ban XĐD, MTTQ, các đoàn thể."),
        ("UBP Bộ Đề - VHXH", "Lớp 1", 5, [(2, "2026-05-05"), (3, "2026-05-12"), (4, "2026-05-26"), (5, "2026-06-01")], "Khối cán bộ. Order thêm 1 buổi."),
        ("UBP Bộ Đề - VHXH", "Lớp 5", 5, [(2, "2026-05-06"), (3, "2026-05-19"), (4, "2026-05-21")], "Khối Giáo dục."),
        ("UBP Giảng Võ", "Lớp 1", 4, [(1, "2026-05-14"), (2, "2026-05-28"), (3, "2026-06-11")], "Theo bảng theo dõi nguồn."),
        ("UBP Giảng Võ", "Lớp 2", 4, [(1, "2026-05-15"), (2, "2026-05-29"), (3, "2026-06-12")], "Theo bảng theo dõi nguồn."),
        ("Ban QL dự án Giảng Võ", "Nhóm chung", 5, [(1, "2026-06-10"), (2, "2026-07-02"), (3, "2026-07-08"), (4, "2026-07-14")], "Buổi 5 chưa có lịch."),
        ("THCS Nguyễn Du", "Lớp chung", 5, [(1, "2026-05-22"), (2, "2026-05-27"), (3, "2026-07-03"), (4, "2026-07-13"), (5, "2026-07-24", "planned")], "Buổi 5 ghi là chưa học trong bảng nguồn."),
        ("Xuân Mai", "Lớp 1", 2, [(1, "2026-06-20"), (2, "2026-06-20")], "Theo bảng theo dõi nguồn."),
        ("Xuân Mai", "Lớp 2", 2, [], "Chưa có lịch 2 buổi."),
        ("Xuân Mai", "Lớp 3", 2, [(1, "2026-06-06"), (2, "2026-06-06")], "Theo bảng theo dõi nguồn."),
        ("Xuân Mai", "Lớp 4", 1, [], "Chưa có lịch buổi học."),
        ("Xuân Mai", "Lớp 5", 2, [(1, "2026-06-27"), (2, "2026-06-27")], "Theo bảng theo dõi nguồn."),
        ("URENCO", "Nhóm 1", 5, [(1, "2026-07-06"), (2, "2026-07-06"), (3, "2026-07-07"), (4, "2026-07-08"), (5, "2026-07-09")], "Tổng 12 buổi; bảng nguồn chia thành 3 hàng theo phòng, không theo lớp."),
        ("URENCO", "Nhóm 2", 5, [(1, "2026-07-10"), (2, "2026-07-13"), (3, "2026-07-14"), (4, "2026-07-21"), (5, "2026-07-21")], "Tổng 12 buổi; bảng nguồn chia thành 3 hàng theo phòng, không theo lớp."),
        ("URENCO", "Nhóm 3", 2, [(1, "2026-07-23"), (2, "2026-07-23")], "Tổng 12 buổi; bảng nguồn chia thành 3 hàng theo phòng, không theo lớp."),
        ("THPT Nhân Chính", "Lớp chung", 5, [(1, "2026-07-11"), (2, "2026-07-22"), (3, "2026-07-24", "planned"), (4, "2026-07-29", "planned"), (5, "2026-07-31", "planned")], "Theo bảng theo dõi nguồn."),
        ("BDA Phúc Thịnh", "Lớp chung", 5, [(1, "2026-04-19")], "Các buổi còn lại chưa có lịch."),
        ("VHXH Xã Yên Lãng", "Lớp chung", 3, [(1, "2026-04-28"), (2, "2026-07-25"), (3, "2026-07-25")], "Theo bảng theo dõi nguồn."),
    ]
    groups = {}
    for partner_name, class_name, planned, class_sessions, notes in rows:
        groups.setdefault(partner_name, []).append((class_name, planned, class_sessions, notes))
    for partner_name, classes in groups.items():
        partner, _ = Partner.objects.update_or_create(name=partner_name, defaults={
            "training_content": "Đào tạo số theo danh sách theo dõi",
            "planned_sessions": sum(item[1] for item in classes),
            "notes": "Dữ liệu khởi tạo từ bảng theo dõi đào tạo đối tác do người dùng cung cấp ngày 28/07/2026.",
        })
        for class_name, planned, class_sessions, notes in classes:
            training_class, _ = TrainingClass.objects.update_or_create(partner=partner, name=class_name, defaults={"planned_sessions": planned, "notes": notes})
            for item in class_sessions:
                number, date_value, *optional_status = item
                Session.objects.update_or_create(training_class=training_class, title=f"Buổi {number} · {class_name}", defaults={
                    "session_date": date.fromisoformat(date_value), "partner": partner.name, "partner_ref": partner,
                    "status": optional_status[0] if optional_status else "completed",
                    "notes": f"Dữ liệu khởi tạo từ bảng theo dõi: Buổi {number} của {class_name}.",
                })


def reverse_seed_training_tracking(apps, schema_editor):
    # Schema rollback must not silently erase operational data.
    pass


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0004_trainingclass_trainingsession_training_class_and_more")]
    operations = [migrations.RunPython(seed_training_tracking, reverse_seed_training_tracking)]