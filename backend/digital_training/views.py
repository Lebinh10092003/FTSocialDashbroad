from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.permissions import IsManagerOrAdmin
from .models import TrainingMaterial, TrainingPartner, TrainingSession, TrainingSurvey
from .serializers import TrainingMaterialSerializer, TrainingPartnerSerializer, TrainingSessionSerializer, TrainingSurveySerializer


def _can_manage(request):
    return IsManagerOrAdmin().has_permission(request, None)


def _forbidden():
    return Response({"error": "Bạn không có quyền thay đổi dữ liệu Đào tạo số."}, status=status.HTTP_403_FORBIDDEN)


def _crud_collection(request, queryset, serializer_class):
    if request.method == "GET":
        return Response(serializer_class(queryset, many=True, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    serializer = serializer_class(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    item = serializer.save()
    return Response(serializer_class(item, context={"request": request}).data, status=status.HTTP_201_CREATED)


def _crud_detail(request, queryset, serializer_class, pk):
    item = queryset.filter(pk=pk).first()
    if not item:
        return Response({"error": "Không tìm thấy dữ liệu."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(serializer_class(item, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    if request.method == "DELETE":
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = serializer_class(item, data=request.data, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    return Response(serializer_class(serializer.save(), context={"request": request}).data)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def training_sessions(request):
    return _crud_collection(request, TrainingSession.objects.select_related("partner_ref").all(), TrainingSessionSerializer)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def training_session_detail(request, pk):
    return _crud_detail(request, TrainingSession.objects.select_related("partner_ref").all(), TrainingSessionSerializer, pk)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def training_partners(request):
    return _crud_collection(request, TrainingPartner.objects.all(), TrainingPartnerSerializer)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def training_partner_detail(request, pk):
    partner = TrainingPartner.objects.filter(pk=pk).first()
    if not partner:
        return Response({"error": "Không tìm thấy đối tác."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        data = TrainingPartnerSerializer(partner, context={"request": request}).data
        data["sessions"] = TrainingSessionSerializer(partner.sessions.all(), many=True, context={"request": request}).data
        data["materials"] = TrainingMaterialSerializer(partner.materials.all(), many=True, context={"request": request}).data
        data["surveys"] = TrainingSurveySerializer(partner.surveys.all(), many=True, context={"request": request}).data
        return Response(data)
    return _crud_detail(request, TrainingPartner.objects.all(), TrainingPartnerSerializer, pk)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def training_materials(request):
    return _crud_collection(request, TrainingMaterial.objects.select_related("session", "partner").all(), TrainingMaterialSerializer)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def training_material_detail(request, pk):
    return _crud_detail(request, TrainingMaterial.objects.select_related("session", "partner").all(), TrainingMaterialSerializer, pk)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def training_surveys(request):
    return _crud_collection(request, TrainingSurvey.objects.select_related("session", "partner").all(), TrainingSurveySerializer)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def training_survey_detail(request, pk):
    return _crud_detail(request, TrainingSurvey.objects.select_related("session", "partner").all(), TrainingSurveySerializer, pk)