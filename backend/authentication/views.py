from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from .models import UserProfile, UserLogin, SystemConfig
from .permissions import IsAuthenticated, IsAdmin
import uuid
import os

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def auth_me(request):
    user = request.user
    now = timezone.now()
    user.last_login = now
    user.save()
    
    return Response({
        "uid": f"mock-uid-{user.email}",
        "email": user.email,
        "name": user.name or user.email.split('@')[0],
        "picture": user.photo_url or "",
        "role": request.user_role,
        "lastLogin": now.isoformat()
    })

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def update_profile(request):
    user = request.user
    data = request.data or {}
    
    display_name = data.get('displayName') or data.get('name')
    photo_url = data.get('photoURL') or data.get('photo_url')
    
    if display_name:
        user.name = display_name
    if photo_url:
        user.photo_url = photo_url
        
    user.last_login = timezone.now()
    user.save()
    
    # Log the login
    log_id = f"login_{int(timezone.now().timestamp() * 1000)}_{uuid.uuid4().hex[:5]}"
    user_agent = request.META.get('HTTP_USER_AGENT', '')
    ip = request.META.get('REMOTE_ADDR', '')
    
    UserLogin.objects.create(
        id=log_id,
        email=user.email,
        name=user.name or '',
        role=user.role,
        login_at=timezone.now(),
        user_agent=user_agent,
        ip=ip
    )
    
    return Response({
        "email": user.email,
        "name": user.name,
        "picture": user.photo_url or "",
        "role": user.role,
        "lastLogin": user.last_login.isoformat()
    })

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auth_sync(request):
    """POST /api/auth/sync - Lưu thông tin đăng nhập và phiên làm việc"""
    user = request.user
    data = request.data or {}
    
    display_name = data.get('displayName') or data.get('name')
    if display_name and display_name != user.name:
        user.name = display_name
    
    user.last_login = timezone.now()
    user.save()
    
    # Log the login
    log_id = f"login_{int(timezone.now().timestamp() * 1000)}_{uuid.uuid4().hex[:5]}"
    UserLogin.objects.create(
        id=log_id,
        email=user.email,
        name=user.name or '',
        role=user.role,
        login_at=timezone.now(),
        user_agent=request.META.get('HTTP_USER_AGENT', ''),
        ip=request.META.get('REMOTE_ADDR', '')
    )
    
    return Response({
        "success": True,
        "user": {
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "picture": user.photo_url or "",
        }
    })

@api_view(['GET', 'POST'])
@permission_classes([IsAdmin])
def manage_users(request):
    if request.method == 'GET':
        users = UserProfile.objects.all().order_by('-updated_at')
        result = []
        for u in users:
            result.append({
                "email": u.email,
                "name": u.name or u.email.split('@')[0],
                "photoURL": u.photo_url or "",
                "role": u.role,
                "updatedAt": u.updated_at.isoformat()
            })
        return Response(result)
        
    elif request.method == 'POST':
        data = request.data or {}
        email = data.get('email')
        role = data.get('role', 'EMPLOYEE')
        
        if not email:
            return Response({"error": "Thiếu email."}, status=status.HTTP_400_BAD_REQUEST)
            
        user_profile, created = UserProfile.objects.update_or_create(
            email=email,
            defaults={'role': role}
        )
        return Response({
            "email": user_profile.email,
            "role": user_profile.role,
            "updatedAt": user_profile.updated_at.isoformat()
        })

@api_view(['PUT', 'DELETE'])
@permission_classes([IsAdmin])
def manage_single_user(request, email):
    try:
        user_profile = UserProfile.objects.get(email=email)
    except UserProfile.DoesNotExist:
        return Response({"error": "Không tìm thấy người dùng."}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        data = request.data or {}
        role = data.get('role')
        if not role:
            return Response({"error": "Thiếu vai trò."}, status=status.HTTP_400_BAD_REQUEST)
            
        user_profile.role = role
        user_profile.save()
        return Response({
            "email": user_profile.email,
            "role": user_profile.role,
            "updatedAt": user_profile.updated_at.isoformat()
        })
        
    elif request.method == 'DELETE':
        user_profile.delete()
        return Response({"success": True, "email": email})

@api_view(['GET'])
@permission_classes([IsAdmin])
def list_logins(request):
    logins = UserLogin.objects.all().order_by('-login_at')[:200]
    result = []
    for l in logins:
        result.append({
            "id": l.id,
            "email": l.email,
            "name": l.name,
            "role": l.role,
            "loginAt": l.login_at.isoformat(),
            "userAgent": l.user_agent,
            "ip": l.ip
        })
    return Response(result)

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def system_config_view(request):
    if request.method == 'GET':
        config = SystemConfig.objects.filter(key='main').first()
        if not config:
            return Response({})
        return Response(config.data)
        
    elif request.method == 'POST':
        # Require ADMIN to change config
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({"error": "Quyền truy cập bị từ chối."}, status=status.HTTP_403_FORBIDDEN)
            
        data = request.data or {}
        config, created = SystemConfig.objects.get_or_create(key='main')
        
        # Merge old config data
        current_data = config.data or {}
        current_data.update(data)
        config.data = current_data
        
        # Sync attributes
        if 'adminEmails' in data:
            config.admin_emails = data['adminEmails']
        if 'lastGoogleAccessToken' in data:
            config.last_google_access_token = data['lastGoogleAccessToken']
            config.last_google_access_token_time = timezone.now()
            
        config.save()
        return Response(config.data)

import base64
import urllib.parse
import re

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload_image(request):
    try:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        upload_dir = os.path.join(project_root, 'uploads')
        os.makedirs(upload_dir, exist_ok=True)

        filename = None
        mime_type = None
        file_bytes = None

        content_type = request.content_type.split(';')[0].strip().lower() if request.content_type else ''

        if content_type in ['image/jpeg', 'image/png', 'image/gif', 'image/webp']:
            filename = request.headers.get('X-File-Name', 'image')
            try:
                filename = urllib.parse.unquote(filename)
            except Exception:
                pass
            mime_type = content_type
            file_bytes = request.body
        else:
            data = request.data or {}
            filename = data.get('filename')
            base64_data = data.get('base64')
            if filename and base64_data:
                if ',' in base64_data:
                    header, base64_data = base64_data.split(',', 1)
                    if 'image/' in header:
                        mime_type = header.split(';')[0].split(':', 1)[1]
                else:
                    mime_type = 'image/png'
                file_bytes = base64.b64decode(base64_data)

        if not file_bytes:
            return Response({'error': 'Không nhận diện được tệp hình ảnh hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        if len(file_bytes) > 3 * 1024 * 1024:
            return Response({'error': 'Dung lượng ảnh vượt quá giới hạn 3MB.'}, status=status.HTTP_400_BAD_REQUEST)

        valid_signature = False
        ext = '.png'
        if mime_type == 'image/jpeg':
            valid_signature = len(file_bytes) >= 3 and file_bytes[0] == 0xff and file_bytes[1] == 0xd8 and file_bytes[2] == 0xff
            ext = '.jpg'
        elif mime_type == 'image/png':
            signature = b'\x89PNG\r\n\x1a\n'
            valid_signature = len(file_bytes) >= len(signature) and file_bytes[:len(signature)] == signature
            ext = '.png'
        elif mime_type == 'image/gif':
            valid_signature = len(file_bytes) >= 6 and (file_bytes[:6] == b'GIF87a' or file_bytes[:6] == b'GIF89a')
            ext = '.gif'
        elif mime_type == 'image/webp':
            valid_signature = len(file_bytes) >= 12 and file_bytes[:4] == b'RIFF' and file_bytes[8:12] == b'WEBP'
            ext = '.webp'

        if not valid_signature:
            return Response({'error': 'Định dạng tệp không khớp với chữ ký hình ảnh.'}, status=status.HTTP_400_BAD_REQUEST)

        name_part, _ = os.path.splitext(filename) if filename else ('image', '')
        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', name_part)
        unique_filename = f"{safe_name}_{uuid.uuid4().hex[:8]}{ext}"

        filepath = os.path.join(upload_dir, unique_filename)
        with open(filepath, 'wb') as f:
            f.write(file_bytes)

        return Response({
            'success': True,
            'url': f"/uploads/{unique_filename}"
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

