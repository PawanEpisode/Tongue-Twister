from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views
from .practice import views as practice

router = DefaultRouter()
router.register("categories", views.CategoryViewSet, basename="category")
router.register("twisters", views.TwisterViewSet, basename="twister")
router.register("attempts", views.AttemptViewSet, basename="attempt")
router.register("sessions", practice.SessionViewSet, basename="session")

urlpatterns = [
    path("me/", views.me),
    path("me/preferences/", practice.preferences),
    path("me/entitlements/", practice.entitlements),
    path("flags/", practice.feature_flags),
    path("sync/guest/", practice.sync_guest),
    path("", include(router.urls)),
]
