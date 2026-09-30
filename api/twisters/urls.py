from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views
from .practice import views as practice
from .speak import views as speak

router = DefaultRouter()
router.register("categories", views.CategoryViewSet, basename="category")
router.register("twisters", views.TwisterViewSet, basename="twister")
router.register("attempts", speak.AttemptViewSet, basename="attempt")
router.register("sessions", practice.SessionViewSet, basename="session")

urlpatterns = [
    path("me/", views.me),
    path("me/preferences/", practice.preferences),
    path("me/entitlements/", practice.entitlements),
    path("me/words/weak/", speak.weak_words),
    path("me/sounds/", speak.weak_sounds),
    path("engine/manifest/", speak.engine_manifest),
    path("internal/scoring-jobs/<uuid:job_id>/result/", speak.scoring_job_result),
    path("flags/", practice.feature_flags),
    path("sync/guest/", practice.sync_guest),
    path("", include(router.urls)),
]
