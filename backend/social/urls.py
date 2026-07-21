from django.urls import path
from . import views

urlpatterns = [
    path('channels', views.channels_list, name='channels_list'),
    path('channels/<str:channel_id>', views.channel_detail, name='channel_detail'),
    path('channels/<str:channel_id>/test-connection', views.channel_test_connection, name='channel_test_connection'),
    path('channels/<str:channel_id>/sync', views.channel_sync, name='channel_sync'),
    path('media-summary/trend', views.media_summary_trend, name='media_summary_trend'),
    path('media-summary', views.media_summary, name='media_summary'),
    path('followers/trend', views.followers_trend, name='followers_trend'),
    path('dashboard', views.dashboard_view, name='dashboard_view'),
    path('sync/all', views.sync_all, name='sync_all'),
    path('sync/history', views.sync_history, name='sync_history'),
    path('posts', views.posts_list, name='posts_list'),
]
