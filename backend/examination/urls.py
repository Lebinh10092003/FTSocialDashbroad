from django.urls import path
from . import views

urlpatterns = [
    path('examination/bootstrap', views.examination_bootstrap, name='examination_bootstrap'),
    path('examination/partners', views.partners_detail, name='partners_detail'),
    path('examination/competitions', views.competition_create, name='competition_create'),
    path('examination/competitions/<str:pk>', views.competition_detail, name='competition_detail'),
    path('examination/sessions', views.session_create, name='session_create'),
    path('examination/sessions/<str:pk>', views.session_detail, name='session_detail'),
    path('examination/candidates/<str:pk>', views.candidate_detail, name='candidate_detail'),
    path('examination/round-results/<uuid:pk>', views.round_result_detail, name='round_result_detail'),
    path('examination/candidates/<str:pk>/sessions/<str:session_id>', views.candidate_remove_from_session, name='candidate_remove_from_session'),
    path('examination/sheets', views.sheets_list, name='sheets_list'),
    path('examination/sheets/<str:pk>', views.sheet_detail, name='sheet_detail'),
    path('examination/sheets/<str:pk>/export', views.sheet_export, name='sheet_export'),
    path('examination/sync/google-sheet', views.sheets_sync, name='sheets_sync'),
    path('examination/sync/status', views.sync_status, name='sync_status'),
    path('examination/import/candidates', views.import_candidates, name='import_candidates'),
    path('examination/lognotes/<str:entityKey>', views.lognotes_detail, name='lognotes_detail'),
    path('examination/<str:resource>', views.get_resource_list, name='get_resource_list'),
]
