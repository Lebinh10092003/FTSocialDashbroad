from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from authentication.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
import json
import uuid

from authentication.permissions import IsManagerOrAdmin
from authentication.models import UserProfile
from examination.models import LogNote
from .completion_service import complete_past_training_schedules
from .models import TrainingClass, TrainingCustomerMeeting, TrainingMaterial, TrainingPartner, TrainingProduct, TrainingProductSubscription, TrainingSession, TrainingSurvey
from .serializers import TrainingClassSerializer, TrainingCustomerMeetingSerializer, TrainingMaterialSerializer, TrainingPartnerSerializer, TrainingProductSerializer, TrainingProductSubscriptionSerializer, TrainingSessionSerializer, TrainingSurveySerializer


def _can_manage(request):
    return IsManagerOrAdmin().has_permission(request, None)


def _forbidden():
    return Response({"error": "Bạn không có quyền thay đổi dữ liệu Đào tạo số."}, status=status.HTTP_403_FORBIDDEN)


def _actor(request):
    return getattr(request.user, "email", "") or getattr(request, "user_email", "") or "Nhân viên FT Workspace"


def _snapshot(serializer_class, item, request):
    return dict(serializer_class(item, context={"request": request}).data)


def _parent_partner(item):
    if isinstance(item, TrainingPartner):
        return item
    if isinstance(item, TrainingClass):
        return item.partner
    if isinstance(item, TrainingSession):
        return item.partner_ref or (item.training_class.partner if item.training_class else None)
    return getattr(item, "partner", None)


def _append_training_audit(entity_key, action, before, after, request, system=False):
    payload = after if after is not None else before
    content = f"{action}. Toàn bộ dữ liệu: {json.dumps(payload or {}, ensure_ascii=False, default=str, separators=(',', ':'))}"
    actor_email = "" if system else (getattr(request.user, "email", "") or "")
    profile = UserProfile.objects.filter(email=actor_email).first() if actor_email else None
    LogNote.objects.create(
        key=f"{entity_key}:{uuid.uuid4().hex}",
        entity_key=entity_key,
        content=content,
        updated_by=_actor(request) if not system else "Hệ thống FT Workspace",
        actor_email=actor_email or None,
        actor_photo_url=(profile.photo_url or "") if profile else "",
        system=system,
    )
    return content


def _audit_item(item, kind, action, before, request, serializer_class, system=False):
    after = _snapshot(serializer_class, item, request) if item is not None else None
    content = _append_training_audit(f"digital-training-{kind}-{item.pk if item is not None else before.get('id')}", action, before, after, request, system)
    parent = _parent_partner(item) if item is not None else None
    if parent is not None:
        _append_training_audit(f"digital-training-partner-{parent.pk}", f"{action} ({kind})", before, after, request, system)
    return after, content


def _crud_collection(request, queryset, serializer_class, kind):
    if request.method == "GET":
        return Response(serializer_class(queryset, many=True, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    serializer = serializer_class(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    item = serializer.save()
    _audit_item(item, kind, f"Tạo {kind}", None, request, serializer_class)
    return Response(serializer_class(item, context={"request": request}).data, status=status.HTTP_201_CREATED)


def _crud_detail(request, queryset, serializer_class, pk, kind):
    item = queryset.filter(pk=pk).first()
    if not item:
        return Response({"error": "Không tìm thấy dữ liệu."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(serializer_class(item, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    if request.method == "DELETE":
        before = _snapshot(serializer_class, item, request)
        _audit_item(item, kind, f"Xóa {kind}", before, request, serializer_class)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    before = _snapshot(serializer_class, item, request)
    serializer = serializer_class(item, data=request.data, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    updated = serializer.save()
    _audit_item(updated, kind, f"Cập nhật {kind}", before, request, serializer_class)
    return Response(serializer_class(updated, context={"request": request}).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_sessions(request):
    if request.method == "GET":
        complete_past_training_schedules()
    return _crud_collection(request, TrainingSession.objects.select_related("partner_ref", "training_class").all(), TrainingSessionSerializer, "buổi tập huấn")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_session_detail(request, pk):
    return _crud_detail(request, TrainingSession.objects.select_related("partner_ref", "training_class").all(), TrainingSessionSerializer, pk, "buổi tập huấn")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_customer_meetings(request):
    if request.method == "GET":
        complete_past_training_schedules()
    return _crud_collection(request, TrainingCustomerMeeting.objects.all(), TrainingCustomerMeetingSerializer, "cuộc gặp khách hàng")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_customer_meeting_detail(request, pk):
    return _crud_detail(request, TrainingCustomerMeeting.objects.all(), TrainingCustomerMeetingSerializer, pk, "cuộc gặp khách hàng")

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_partners(request):
    return _crud_collection(request, TrainingPartner.objects.all(), TrainingPartnerSerializer, "khách hàng")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_partner_detail(request, pk):
    partner = TrainingPartner.objects.filter(pk=pk).first()
    if not partner:
        return Response({"error": "Không tìm thấy khách hàng."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        complete_past_training_schedules()
        data = TrainingPartnerSerializer(partner, context={"request": request}).data
        data["classes"] = TrainingClassSerializer(partner.classes.all(), many=True, context={"request": request}).data
        data["sessions"] = TrainingSessionSerializer(partner.sessions.select_related("partner_ref", "training_class").all(), many=True, context={"request": request}).data
        data["materials"] = TrainingMaterialSerializer(partner.materials.all(), many=True, context={"request": request}).data
        data["surveys"] = TrainingSurveySerializer(partner.surveys.all(), many=True, context={"request": request}).data
        return Response(data)
    return _crud_detail(request, TrainingPartner.objects.all(), TrainingPartnerSerializer, pk, "khách hàng")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_classes(request):
    return _crud_collection(request, TrainingClass.objects.select_related("partner").all(), TrainingClassSerializer, "lớp/phân nhóm")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_class_detail(request, pk):
    return _crud_detail(request, TrainingClass.objects.select_related("partner").all(), TrainingClassSerializer, pk, "lớp/phân nhóm")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_products(request):
    queryset = TrainingProduct.objects.prefetch_related("subscriptions").all()
    return _crud_collection(request, queryset, TrainingProductSerializer, "sản phẩm")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_detail(request, pk):
    if request.method == "DELETE" and not _can_manage(request):
        return _forbidden()
    item = TrainingProduct.objects.prefetch_related("subscriptions").filter(pk=pk).first()
    if request.method == "DELETE" and item and item.subscriptions.exists():
        return Response({"error": "San pham dang co khach hang su dung; hay chuyen sang ngung hoat dong thay vi xoa."}, status=status.HTTP_400_BAD_REQUEST)
    return _crud_detail(request, TrainingProduct.objects.prefetch_related("subscriptions").all(), TrainingProductSerializer, pk, "sản phẩm")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_subscriptions(request):
    queryset = TrainingProductSubscription.objects.select_related("partner", "product").all()
    return _crud_collection(request, queryset, TrainingProductSubscriptionSerializer, "đăng ký sản phẩm")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_subscription_detail(request, pk):
    queryset = TrainingProductSubscription.objects.select_related("partner", "product").all()
    return _crud_detail(request, queryset, TrainingProductSubscriptionSerializer, pk, "đăng ký sản phẩm")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_materials(request):
    return _crud_collection(request, TrainingMaterial.objects.select_related("session", "partner").all(), TrainingMaterialSerializer, "tài liệu")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_material_detail(request, pk):
    return _crud_detail(request, TrainingMaterial.objects.select_related("session", "partner").all(), TrainingMaterialSerializer, pk, "tài liệu")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_surveys(request):
    return _crud_collection(request, TrainingSurvey.objects.select_related("session", "partner").all(), TrainingSurveySerializer, "phiếu khảo sát")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_survey_detail(request, pk):
    return _crud_detail(request, TrainingSurvey.objects.select_related("session", "partner").all(), TrainingSurveySerializer, pk, "phiếu khảo sát")
