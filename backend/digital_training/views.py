from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from authentication.permissions import IsManagerOrAdmin
from .models import TrainingSession
from .serializers import TrainingSessionSerializer

@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def training_sessions(request):
    if request.method == "GET":
        return Response(TrainingSessionSerializer(TrainingSession.objects.all(), many=True).data)
    if not IsManagerOrAdmin().has_permission(request, None):
        return Response({"error": "Bạn không có quyền tạo buổi đào tạo."}, status=403)
    serializer = TrainingSessionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    session = serializer.save()
    return Response(TrainingSessionSerializer(session).data, status=201)
