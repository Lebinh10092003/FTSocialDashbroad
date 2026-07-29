from django.db import migrations


def distribute_shared_sessions_to_classes(apps, schema_editor):
    Partner = apps.get_model("digital_training", "TrainingPartner")
    TrainingClass = apps.get_model("digital_training", "TrainingClass")
    Session = apps.get_model("digital_training", "TrainingSession")

    for partner in Partner.objects.all().iterator():
        shared = list(
            Session.objects.filter(partner_ref=partner, training_class__isnull=True, title__startswith="Buổi chung")
            .order_by("session_number", "session_date", "start_time", "id")
        )
        class_groups = list(TrainingClass.objects.filter(partner=partner))
        if not shared or not class_groups:
            continue

        shared_count = len(shared)
        for group in class_groups:
            class_sessions = list(
                Session.objects.filter(training_class=group)
                .order_by("session_number", "session_date", "start_time", "id")
            )
            for ordinal, item in enumerate(class_sessions, start=1):
                item.session_number = (item.session_number or ordinal) + shared_count
                item.save(update_fields=["session_number"])
            for ordinal, item in enumerate(shared, start=1):
                Session.objects.create(
                    title=f"Buổi {ordinal} · {partner.name} · {group.name}",
                    session_number=ordinal,
                    session_date=item.session_date,
                    start_time=item.start_time,
                    end_time=item.end_time,
                    partner=partner.name,
                    partner_ref=partner,
                    training_class=group,
                    category=item.category,
                    contents=item.contents,
                    attendees=item.attendees,
                    location=item.location,
                    status=item.status,
                    notes="Buổi tập huấn chung áp dụng cho lớp này.",
                    staff_name=item.staff_name,
                )
            group.planned_sessions += shared_count
            group.save(update_fields=["planned_sessions"])

        Session.objects.filter(pk__in=[item.pk for item in shared]).delete()


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0015_trainingcustomermeeting_activity_type_and_more")]
    operations = [migrations.RunPython(distribute_shared_sessions_to_classes, migrations.RunPython.noop)]