from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views
from .media import views as media
from .practice import views as practice
from .progress import views as progress
from .speak import views as speak

router = DefaultRouter()
router.register("categories", views.CategoryViewSet, basename="category")
router.register("twisters", views.TwisterViewSet, basename="twister")
router.register("attempts", speak.AttemptViewSet, basename="attempt")
router.register("sessions", practice.SessionViewSet, basename="session")
router.register("recordings", media.RecordingViewSet, basename="recording")
router.register("shares", media.ShareViewSet, basename="share")

urlpatterns = [
    path("me/", views.me),
    path("me/summary/", progress.me_summary),
    path("me/achievements/", progress.me_achievements),
    path("me/achievements/seen/", progress.me_achievements_seen),
    path("me/stats/", progress.me_stats),
    path("me/activity/", progress.me_activity),
    path("me/favorites/", progress.FavoriteList.as_view()),
    path("me/favorites/<slug:slug>/", progress.me_favorite),
    path("daily/", progress.daily_view),
    path("leaderboard/weekly/", progress.weekly_board),
    path("me/preferences/", practice.preferences),
    path("me/entitlements/", practice.entitlements),
    path("me/words/weak/", speak.weak_words),
    path("me/sounds/", speak.weak_sounds),
    path("me/consents/", media.consents),
    path("me/consents/<str:consent_type>/", media.consent_revoke),
    path("me/storage/", media.storage_usage),
    path("voice/", media.voice_create),
    path("voice/<uuid:asset_id>/complete/", media.voice_complete),
    path("public/r/<slug:token>/", media.PublicRecordingView.as_view()),
    path("public/r/<slug:token>/report/", media.PublicReportView.as_view()),
    path("public/s/<slug:token>/", media.PublicScoreCardView.as_view()),
    path("internal/media/claim/", media.media_claim),
    path("internal/media/jobs/<uuid:job_id>/heartbeat/", media.media_heartbeat),
    path("internal/media/<uuid:asset_id>/processed/", media.media_processed),
    path("engine/manifest/", speak.engine_manifest),
    path("internal/scoring-jobs/<uuid:job_id>/result/", speak.scoring_job_result),
    path("flags/", practice.feature_flags),
    path("sync/guest/", practice.sync_guest),
    path("", include(router.urls)),
]
