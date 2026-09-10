from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from authentication.models import WorkspaceNotification

from .models import TrainingPartner, TrainingProduct, TrainingProductSubscription
from .product_lifecycle import run_product_subscription_lifecycle
from .serializers import TrainingProductSubscriptionSerializer


class ProductSubscriptionLifecycleTests(TestCase):
    def setUp(self):
        self.partner = TrainingPartner.objects.create(name="Khách hàng A")
        self.training = TrainingProduct.objects.get(code="tap-huan")
        self.platform = TrainingProduct.objects.get(code="bndc")

    def test_training_subscription_is_always_unlimited(self):
        serializer = TrainingProductSubscriptionSerializer(data={
            "partner": self.partner.pk,
            "product": self.training.pk,
            "quantity": 4,
            "expires_at": timezone.localdate() - timedelta(days=1),
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        subscription = serializer.save()
        self.assertIsNone(subscription.expires_at)
        self.assertEqual(serializer.data["effective_status"], "active")

    def test_clearing_expiry_resets_status_and_removes_old_notice(self):
        subscription = TrainingProductSubscription.objects.create(
            partner=self.partner,
            product=self.platform,
            expires_at=timezone.localdate() - timedelta(days=2),
            expiry_notice_stage=2,
        )
        WorkspaceNotification.objects.create(
            event_key=f"product-subscription:{subscription.pk}:old:2",
            title="Đã hết hạn",
            message="Cũ",
        )
        serializer = TrainingProductSubscriptionSerializer(
            subscription,
            data={"expires_at": None},
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        subscription = serializer.save()
        self.assertIsNone(subscription.expires_at)
        self.assertEqual(subscription.expiry_notice_stage, 0)
        self.assertEqual(serializer.data["effective_status"], "active")
        self.assertFalse(WorkspaceNotification.objects.filter(event_key__startswith=f"product-subscription:{subscription.pk}:").exists())

    def test_due_only_lifecycle_creates_linked_notifications(self):
        expiring = TrainingProductSubscription.objects.create(
            partner=self.partner,
            product=self.platform,
            expires_at=timezone.localdate() + timedelta(days=10),
        )
        expired = TrainingProductSubscription.objects.create(
            partner=TrainingPartner.objects.create(name="Khách hàng B"),
            product=self.platform,
            expires_at=timezone.localdate() - timedelta(days=1),
        )
        result = run_product_subscription_lifecycle()
        self.assertEqual(result, {"expiring": 1, "expired": 1})
        self.assertEqual(WorkspaceNotification.objects.count(), 2)
        notice = WorkspaceNotification.objects.get(event_key__contains=f":{expired.expires_at.isoformat()}:2")
        self.assertEqual(notice.severity, "urgent")
        self.assertEqual(notice.action_url, f"/digital-training/partners/{expired.partner_id}")
        self.assertEqual(notice.target_modules, ["digital-training", "finance-report"])
        self.assertEqual(run_product_subscription_lifecycle(), {"expiring": 0, "expired": 0})
        expiring.refresh_from_db()
        expired.refresh_from_db()
        self.assertEqual(expiring.expiry_notice_stage, 1)
        self.assertEqual(expired.expiry_notice_stage, 2)
