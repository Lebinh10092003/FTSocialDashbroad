from django.urls import path
from . import views

urlpatterns = [
    path('email-templates', views.email_templates_list, name='email_templates_list'),
    path('email-templates/<str:template_id>', views.email_template_detail, name='email_template_detail'),
    path('email-user-prefs', views.email_user_prefs, name='email_user_prefs'),
]
