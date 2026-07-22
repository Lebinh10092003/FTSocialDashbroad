from django.urls import path
from . import views
urlpatterns = [path("digital-training/sessions", views.training_sessions, name="training_sessions")]
