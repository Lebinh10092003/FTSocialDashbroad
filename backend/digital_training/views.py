from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from authentication.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.permissions import BasePermission
import json
import uuid
import unicodedata

from authentication.permissions import IsManagerOrAdmin
from authentication.models import UserProfile
from examination.models import LogNote
from .completion_service import complete_past_training_schedules
from .models import TrainingClass, TrainingCustomerMeeting, TrainingFinanceEntry, TrainingMaterial, TrainingPartner, TrainingProduct, TrainingProductSubscription, TrainingSession, TrainingSurvey
from .serializers import TrainingClassSerializer, TrainingCustomerMeetingSerializer, TrainingFinanceEntrySerializer, TrainingMaterialSerializer, TrainingPartnerSerializer, TrainingProductSerializer, TrainingProductSubscriptionSerializer, TrainingSessionSerializer, TrainingSurveySerializer


def _can_manage(request):
    return IsManagerOrAdmin().has_permission(request, None)


def _forbidden():
    return Response({"error": "Bạn không có quyền thay đổi dữ liệu Đào tạo số."}, status=status.HTTP_403_FORBIDDEN)


def _actor(request):
    return getattr(request.user, "email", "") or getattr(request, "user_email", "") or "Nhân viên FT Workspace"


def _normalise_title(value):
    return "".join(
        char for char in unicodedata.normalize("NFD", str(value or "").lower())
        if unicodedata.category(char) != "Mn"
    ).replace("\u0111", "d")


def _finance_permissions(request):
    role = getattr(request, "user_role", "")
    title = _normalise_title(getattr(getattr(request.user, "job_title", None), "name", ""))
    department_names = [getattr(getattr(request.user, "department", None), "name", "")]
    departments = getattr(request.user, "departments", None)
    if departments is not None:
        department_names.extend(departments.values_list("name", flat=True))
    identity = _normalise_title(" ".join([title, *department_names]))
    is_accountant = "ke toan" in identity
    can_view = role in {"ADMIN", "MANAGER"} or is_accountant or "giam doc" in identity or "quan ly" in identity
    can_edit = role == "ADMIN" or is_accountant
    return can_view, can_edit


def _finance_forbidden(edit=False):
    message = (
        "Ch\u1ec9 K\u1ebf to\u00e1n v\u00e0 Admin \u0111\u01b0\u1ee3c ch\u1ec9nh s\u1eeda b\u00e1o c\u00e1o thu chi."
        if edit else "B\u1ea1n kh\u00f4ng c\u00f3 quy\u1ec1n xem b\u00e1o c\u00e1o thu chi."
    )
    return Response({"error": message}, status=status.HTTP_403_FORBIDDEN)



class CanViewTrainingFinance(BasePermission):
    def has_permission(self, request, view):
        return _finance_permissions(request)[0]


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
@permission_classes([CanViewTrainingFinance])
def training_finance_entries(request):
    can_view, can_edit = _finance_permissions(request)
    if not can_view:
        return _finance_forbidden()
    if request.method == "POST" and not can_edit:
        return _finance_forbidden(edit=True)
    queryset = TrainingFinanceEntry.objects.select_related("partner").all()
    date_from = str(request.query_params.get("date_from") or "").strip()
    date_to = str(request.query_params.get("date_to") or "").strip()
    entry_type = str(request.query_params.get("entry_type") or "").strip()
    entry_status = str(request.query_params.get("status") or "").strip()
    partner = str(request.query_params.get("partner") or "").strip()
    search = str(request.query_params.get("search") or "").strip()
    if date_from:
        queryset = queryset.filter(transaction_date__gte=date_from)
    if date_to:
        queryset = queryset.filter(transaction_date__lte=date_to)
    if entry_type in {"income", "expense"}:
        queryset = queryset.filter(entry_type=entry_type)
    if entry_status in {"pending", "completed", "overdue", "cancelled"}:
        queryset = queryset.filter(status=entry_status)
    if partner.isdigit():
        queryset = queryset.filter(partner_id=int(partner))
    if search:
        from django.db.models import Q
        queryset = queryset.filter(
            Q(category__icontains=search) | Q(description__icontains=search)
            | Q(reference_code__icontains=search) | Q(partner__name__icontains=search)
        )
    if request.method == "GET":
        return Response(TrainingFinanceEntrySerializer(queryset, many=True).data)
    serializer = TrainingFinanceEntrySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = getattr(request.user, "email", "")
    item = serializer.save(created_by=email, updated_by=email)
    return Response(TrainingFinanceEntrySerializer(item).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([CanViewTrainingFinance])
def training_finance_entry_detail(request, pk):
    can_view, can_edit = _finance_permissions(request)
    if not can_view:
        return _finance_forbidden()
    if request.method != "GET" and not can_edit:
        return _finance_forbidden(edit=True)
    item = TrainingFinanceEntry.objects.select_related("partner").filter(pk=pk).first()
    if not item:
        return Response({"error": "Kh\u00f4ng t\u00ecm th\u1ea5y kho\u1ea3n thu chi."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(TrainingFinanceEntrySerializer(item).data)
    if request.method == "DELETE":
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = TrainingFinanceEntrySerializer(item, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    updated = serializer.save(updated_by=getattr(request.user, "email", ""))
    return Response(TrainingFinanceEntrySerializer(updated).data)



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
