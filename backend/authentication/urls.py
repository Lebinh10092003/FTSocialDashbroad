from django.urls import path
from . import views

urlpatterns = [
    path('auth/me', views.auth_me, name='auth_me'),
    path('auth/sync', views.auth_sync, name='auth_sync'),
    path('auth/profile', views.update_profile, name='update_profile'),
    path('auth/users', views.manage_users, name='manage_users'),
    path('auth/users/<str:email>', views.manage_single_user, name='manage_single_user'),
    path('auth/logins', views.list_logins, name='list_logins'),
    path('system-config', views.system_config_view, name='system_config_view'),
    path('upload', views.upload_image, name='upload_image'),
]
