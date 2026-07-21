import base64
import json
import os
from rest_framework import authentication
from rest_framework import exceptions
from .models import UserProfile, SystemConfig

class FirebaseTokenAuthentication(authentication.BaseAuthentication):
    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None

        id_token = auth_header.split('Bearer ')[1].strip()
        if not id_token:
            return None

        # Extract google token if sent
        google_token = request.META.get('HTTP_X_GOOGLE_OAUTH_TOKEN')
        if google_token and google_token.strip():
            # Update system config with last google access token
            try:
                config, _ = SystemConfig.objects.get_or_create(key='main')
                config.last_google_access_token = google_token
                from django.utils import timezone
                config.last_google_access_token_time = timezone.now()
                # If config data doesn't have it, merge
                if not config.data:
                    config.data = {}
                config.data['lastGoogleAccessToken'] = google_token
                config.data['lastGoogleAccessTokenTime'] = timezone.now().isoformat()
                config.save()
            except Exception as e:
                print('Error saving backup Google Access Token:', e)

        email = None
        if id_token.startswith('mock-dev-token-'):
            email = id_token.replace('mock-dev-token-', '')
        else:
            parts = id_token.split('.')
            if len(parts) == 3:
                try:
                    # Decode base64 payload
                    payload_b64 = parts[1]
                    # Add padding if necessary
                    payload_b64 += '=' * (-len(payload_b64) % 4)
                    payload_str = base64.b64decode(payload_b64).decode('utf-8')
                    payload = json.loads(payload_str)
                    email = payload.get('email')
                except Exception as err:
                    raise exceptions.AuthenticationFailed(f'Lỗi giải mã token JWT: {str(err)}')
            else:
                raise exceptions.AuthenticationFailed('Định dạng token không hợp lệ.')

        if not email:
            raise exceptions.AuthenticationFailed('Email không hợp lệ.')

        # 1. Determine admin emails
        admin_emails_list = []
        try:
            config = SystemConfig.objects.filter(key='main').first()
            if config and config.admin_emails:
                admin_emails_list = [e.strip().lower() for e in config.admin_emails.split(',') if e.strip()]
        except Exception:
            pass

        if not admin_emails_list:
            admin_emails_env = os.getenv('ADMIN_EMAILS', '')
            admin_emails_list = [e.strip().lower() for e in admin_emails_env.split(',') if e.strip()]

        normalized_email = email.lower()
        is_admin = (normalized_email in admin_emails_list or 
                    normalized_email == 'admin' or 
                    normalized_email == 'admin@ftsocial.com')

        # 2. Get or create UserProfile
        user_profile, created = UserProfile.objects.get_or_create(email=email)
        
        # Determine the role
        stored_role = user_profile.role
        if stored_role == 'VIEWER':
            stored_role = 'EMPLOYEE'
            
        role = 'ADMIN' if is_admin else (stored_role or 'EMPLOYEE')
        
        if created or user_profile.role != role:
            user_profile.role = role
            user_profile.name = user_profile.name or email.split('@')[0]
            user_profile.save()

        # Attach custom attributes for roles checks
        request.user_role = role
        request.google_access_token = google_token or None
        
        if not request.google_access_token:
            # Fallback to config backup token
            try:
                config = SystemConfig.objects.filter(key='main').first()
                if config and config.last_google_access_token:
                    request.google_access_token = config.last_google_access_token
            except Exception:
                pass

        return (user_profile, id_token)
