from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("auth/qr/resolve-google-form", views.resolve_google_form_link, name="resolve_google_form_link"),
    path("auth/login", views.login_view, name="auth_login"),
    path("auth/logout", views.logout_view, name="auth_logout"),
    path("auth/me", views.auth_me, name="auth_me"),
    path("auth/sync", views.auth_sync, name="auth_sync"),
    path("auth/profile", views.update_profile, name="update_profile"),
    path("auth/change-password", views.change_password, name="change_password"),
    path("auth/users", views.manage_users, name="manage_users"),
    path("auth/users/<str:email>", views.manage_single_user, name="manage_single_user"),
    path("auth/users/<str:email>/reset-password", views.reset_employee_password, name="reset_employee_password"),
    path("auth/departments", views.departments_view, name="departments"),
    path("auth/departments/<int:department_id>", views.department_detail, name="department_detail"),
    path("auth/job-titles", views.job_titles_view, name="job_titles"),
    path("auth/job-titles/<int:title_id>", views.job_title_detail, name="job_title_detail"),
    path("auth/logins", views.list_logins, name="list_logins"),
    path("admin/users", views.admin_users, name="admin_users"),
    path("admin/create-user", views.admin_create_user, name="admin_create_user"),
    path("admin/delete-user", views.admin_delete_user, name="admin_delete_user"),
    path("admin/config", views.system_config_view, name="admin_config"),
    path("admin/config/facebook-scan-tokens/<str:token_id>/refresh", views.refresh_facebook_scan_token, name="refresh_facebook_scan_token"),
    path("admin/token-notifications", views.token_notifications, name="token_notifications"),
    path("system-config", views.system_config_view, name="system_config"),
    path("setup/sheets", views.setup_sheets, name="setup_sheets"),
    path("upload", views.upload_image, name="upload_image"),
]
