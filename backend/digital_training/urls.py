from django.urls import path

from . import assessment_views, views

urlpatterns = [
    path("digital-training/sessions", views.training_sessions, name="training_sessions"),
    path("digital-training/sessions/<int:pk>", views.training_session_detail, name="training_session_detail"),
    path("digital-training/customer-meetings", views.training_customer_meetings, name="training_customer_meetings"),
    path("digital-training/customer-meetings/<int:pk>", views.training_customer_meeting_detail, name="training_customer_meeting_detail"),
    path("digital-training/partners", views.training_partners, name="training_partners"),
    path("digital-training/partners/<int:pk>", views.training_partner_detail, name="training_partner_detail"),
    path("digital-training/classes", views.training_classes, name="training_classes"),
    path("digital-training/classes/<int:pk>", views.training_class_detail, name="training_class_detail"),
    path("digital-training/materials", views.training_materials, name="training_materials"),
    path("digital-training/materials/<int:pk>", views.training_material_detail, name="training_material_detail"),
    path("digital-training/surveys", views.training_surveys, name="training_surveys"),
    path("digital-training/surveys/<int:pk>", views.training_survey_detail, name="training_survey_detail"),
    path("digital-training/assessments", assessment_views.assessments, name="training_assessments"),
    path("digital-training/assessments/import-preview", assessment_views.assessment_import_preview, name="training_assessment_import_preview"),
    path("digital-training/assessments/<int:pk>", assessment_views.assessment_detail, name="training_assessment_detail"),
    path("digital-training/assessments/<int:pk>/results", assessment_views.assessment_results, name="training_assessment_results"),
    path("digital-training/assessments/<int:pk>/results/<int:attempt_pk>", assessment_views.assessment_result_grade, name="training_assessment_result_grade"),
    path("training-assessments/<slug:slug>", assessment_views.public_assessment, name="public_training_assessment"),
    path("training-assessments/<slug:slug>/start", assessment_views.public_assessment_start, name="public_training_assessment_start"),
    path("training-assessment-attempts/<uuid:token>", assessment_views.public_attempt, name="public_training_assessment_attempt"),
    path("training-assessment-attempts/<uuid:token>/upload", assessment_views.public_attempt_upload, name="public_training_assessment_upload"),
]
