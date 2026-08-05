from django.db import migrations


def add_catalog_products(apps, schema_editor):
    Product = apps.get_model("digital_training", "TrainingProduct")
    definitions = [
        ("Tập huấn", "tap-huan", "Số buổi tập huấn đã đăng ký", "service", 0),
        ("Dashboard trường học", "dashboard-truong-hoc", "Dashboard dành cho nhà trường", "product", 4),
        ("Dashboard khối hành chính", "dashboard-khoi-hanh-chinh", "Dashboard dành cho khối hành chính", "product", 5),
        ("Chromebook", "chromebook", "Thiết bị Chromebook", "product", 6),
    ]
    for name, code, description, product_type, display_order in definitions:
        Product.objects.get_or_create(
            code=code,
            defaults={
                "name": name, "description": description, "product_type": product_type,
                "display_order": display_order, "active": True,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("digital_training", "0028_add_customer_leads")]
    operations = [migrations.RunPython(add_catalog_products, migrations.RunPython.noop)]
