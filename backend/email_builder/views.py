from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsAuthenticated
from .models import EmailTemplate, EmailUserPref


def _user_email(request):
    return str(getattr(request.user, 'email', '') or '').strip().lower()


def _template_payload(template):
    owner = UserProfile.objects.filter(email=template.created_by).only('name').first()
    return {
        'id': template.id,
        'name': template.name,
        'subject': template.subject,
        'settings': template.settings,
        'blocks': template.blocks,
        'lastUpdated': template.last_updated,
        'createdBy': template.created_by,
        'updatedBy': template.updated_by,
        'ownerName': owner.name if owner and owner.name else template.created_by,
        'isPublished': template.is_published,
        'publishedAt': template.published_at.isoformat() if template.published_at else None,
        'createdAt': template.created_at.isoformat(),
        'updatedAt': template.updated_at.isoformat(),
    }


def _is_owner(template, user_email):
    return template.created_by.strip().lower() == user_email


def _can_edit(template, user_email):
    return template.is_published or _is_owner(template, user_email)


def _apply_template_changes(template, data, user_email):
    for field, payload_key in (
        ('name', 'name'),
        ('subject', 'subject'),
        ('settings', 'settings'),
        ('blocks', 'blocks'),
    ):
        if payload_key in data:
            setattr(template, field, data[payload_key])
    template.last_updated = data.get('lastUpdated', int(timezone.now().timestamp() * 1000))
    template.updated_by = user_email
    template.save()
    return template


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def email_templates_list(request):
    user_email = _user_email(request)
    if request.method == 'GET':
        templates = EmailTemplate.objects.filter(
            Q(created_by__iexact=user_email) | Q(is_published=True)
        ).order_by('-last_updated')
        return Response([_template_payload(template) for template in templates])

    data = request.data or {}
    template_id = data.get('id')
    name = data.get('name')
    if not template_id or not name:
        return Response({'error': 'Thiếu mã hoặc tên mẫu email.'}, status=status.HTTP_400_BAD_REQUEST)

    template = EmailTemplate.objects.filter(id=template_id).first()
    if template:
        if not _can_edit(template, user_email):
            return Response({'error': 'Bạn không có quyền chỉnh sửa mẫu email riêng tư này.'}, status=status.HTTP_403_FORBIDDEN)
        template = _apply_template_changes(template, data, user_email)
        return Response({'template': _template_payload(template)})

    template = EmailTemplate.objects.create(
        id=template_id,
        name=name,
        subject=data.get('subject', ''),
        settings=data.get('settings', {}),
        blocks=data.get('blocks', []),
        last_updated=data.get('lastUpdated', int(timezone.now().timestamp() * 1000)),
        created_by=user_email,
        updated_by=user_email,
    )
    return Response({'template': _template_payload(template)}, status=status.HTTP_201_CREATED)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def email_template_detail(request, template_id):
    user_email = _user_email(request)
    template = EmailTemplate.objects.filter(id=template_id).first()

    if request.method == 'PUT':
        data = request.data or {}
        if template is None:
            template = EmailTemplate.objects.create(
                id=template_id,
                name=data.get('name', 'Mẫu email chưa đặt tên'),
                subject=data.get('subject', ''),
                settings=data.get('settings', {}),
                blocks=data.get('blocks', []),
                last_updated=data.get('lastUpdated', int(timezone.now().timestamp() * 1000)),
                created_by=user_email,
                updated_by=user_email,
            )
            return Response({'template': _template_payload(template)}, status=status.HTTP_201_CREATED)
        if not _can_edit(template, user_email):
            return Response({'error': 'Bạn không có quyền chỉnh sửa mẫu email riêng tư này.'}, status=status.HTTP_403_FORBIDDEN)
        template = _apply_template_changes(template, data, user_email)
        return Response({'template': _template_payload(template)})

    if template is None:
        return Response({'error': 'Không tìm thấy mẫu email.'}, status=status.HTTP_404_NOT_FOUND)
    if not _is_owner(template, user_email):
        return Response({'error': 'Chỉ chủ sở hữu mới có thể xóa mẫu email này.'}, status=status.HTTP_403_FORBIDDEN)
    template.delete()
    return Response({'success': True, 'id': template_id})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def email_template_publish(request, template_id):
    user_email = _user_email(request)
    template = EmailTemplate.objects.filter(id=template_id).first()
    if template is None:
        return Response({'error': 'Không tìm thấy mẫu email.'}, status=status.HTTP_404_NOT_FOUND)
    if not _is_owner(template, user_email):
        return Response({'error': 'Chỉ chủ sở hữu mới có thể chia sẻ mẫu email này.'}, status=status.HTTP_403_FORBIDDEN)
    if not template.is_published:
        template.is_published = True
        template.published_at = timezone.now()
        template.updated_by = user_email
        template.save(update_fields=['is_published', 'published_at', 'updated_by', 'updated_at'])
    return Response({'template': _template_payload(template)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def email_template_unpublish(request, template_id):
    user_email = _user_email(request)
    template = EmailTemplate.objects.filter(id=template_id).first()
    if template is None:
        return Response({'error': 'Không tìm thấy mẫu email.'}, status=status.HTTP_404_NOT_FOUND)
    if not _is_owner(template, user_email):
        return Response({'error': 'Chỉ chủ sở hữu mới có thể dừng chia sẻ mẫu email này.'}, status=status.HTTP_403_FORBIDDEN)
    if template.is_published:
        template.is_published = False
        template.published_at = None
        template.updated_by = user_email
        template.save(update_fields=['is_published', 'published_at', 'updated_by', 'updated_at'])
    return Response({'template': _template_payload(template)})

@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def email_user_prefs(request):
    user_email = request.user.email
    pref, created = EmailUserPref.objects.get_or_create(
        email=user_email,
        defaults={
            "active_template_id": None,
            "left_panel_width": 152,
            "right_panel_width": 300
        }
    )
    
    if request.method == 'GET':
        return Response({
            "activeTemplateId": pref.active_template_id,
            "leftPanelWidth": pref.left_panel_width,
            "rightPanelWidth": pref.right_panel_width
        })
        
    elif request.method == 'PUT':
        data = request.data or {}
        if 'activeTemplateId' in data:
            pref.active_template_id = data['activeTemplateId']
        if 'leftPanelWidth' in data:
            pref.left_panel_width = data['leftPanelWidth']
        if 'rightPanelWidth' in data:
            pref.right_panel_width = data['rightPanelWidth']
            
        pref.save()
        return Response({"success": True})
