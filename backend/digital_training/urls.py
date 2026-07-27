from django.urls import path

from . import views

urlpatterns = [
    path("digital-training/sessions", views.training_sessions, name="training_sessions"),
    path("digital-training/sessions/<int:pk>", views.training_session_detail, name="training_session_detail"),
    path("digital-training/partners", views.training_partners, name="training_partners"),
    path("digital-training/partners/<int:pk>", views.training_partner_detail, name="training_partner_detail"),
    path("digital-training/materials", views.training_materials, name="training_materials"),
    path("digital-training/materials/<int:pk>", views.training_material_detail, name="training_material_detail"),
    path("digital-training/surveys", views.training_surveys, name="training_surveys"),
    path("digital-training/surveys/<int:pk>", views.training_survey_detail, name="training_survey_detail"),
]