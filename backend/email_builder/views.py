from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from .models import EmailTemplate, EmailUserPref
from authentication.permissions import IsAuthenticated

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def email_templates_list(request):
    if request.method == 'GET':
        templates = EmailTemplate.objects.all().order_by('-last_updated')
        result = []
        for t in templates:
            result.append({
                "id": t.id,
                "name": t.name,
                "subject": t.subject,
                "settings": t.settings,
                "blocks": t.blocks,
                "lastUpdated": t.last_updated,
                "createdBy": t.created_by,
                "updatedBy": t.updated_by,
                "createdAt": t.created_at.isoformat(),
                "updatedAt": t.updated_at.isoformat(),
            })
        return Response(result)
        
    elif request.method == 'POST':
        data = request.data or {}
        template_id = data.get('id')
        name = data.get('name')
        
        if not template_id or not name:
            return Response({"error": "Thiếu id hoặc name cho template."}, status=status.HTTP_400_BAD_REQUEST)
            
        user_email = request.user.email
        
        template, created = EmailTemplate.objects.update_or_create(
            id=template_id,
            defaults={
                "name": name,
                "subject": data.get('subject', ''),
                "settings": data.get('settings', {}),
                "blocks": data.get('blocks', []),
                "last_updated": data.get('lastUpdated', int(timezone.now().timestamp() * 1000)),
                "created_by": user_email,
                "updated_by": user_email,
            }
        )
        return Response({"success": True, "id": template.id})

@api_view(['PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def email_template_detail(request, template_id):
    try:
        template = EmailTemplate.objects.get(id=template_id)
    except EmailTemplate.DoesNotExist:
        if request.method == 'PUT':
            # Support idempotent template upsert.
            data = request.data or {}
            user_email = request.user.email
            template = EmailTemplate.objects.create(
                id=template_id,
                name=data.get('name', 'Untitled'),
                subject=data.get('subject', ''),
                settings=data.get('settings', {}),
                blocks=data.get('blocks', []),
                last_updated=data.get('lastUpdated', int(timezone.now().timestamp() * 1000)),
                created_by=user_email,
                updated_by=user_email
            )
            return Response({"success": True, "id": template_id})
        return Response({"error": "Không tìm thấy email template."}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        data = request.data or {}
        user_email = request.user.email
        
        if 'name' in data:
            template.name = data['name']
        if 'subject' in data:
            template.subject = data['subject']
        if 'settings' in data:
            template.settings = data['settings']
        if 'blocks' in data:
            template.blocks = data['blocks']
            
        template.last_updated = data.get('lastUpdated', int(timezone.now().timestamp() * 1000))
        template.updated_by = user_email
        template.save()
        return Response({"success": True, "id": template_id})
        
    elif request.method == 'DELETE':
        template.delete()
        return Response({"success": True, "id": template_id})

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
