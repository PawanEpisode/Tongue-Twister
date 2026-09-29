from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("categories", views.CategoryViewSet, basename="category")
router.register("twisters", views.TwisterViewSet, basename="twister")
router.register("attempts", views.AttemptViewSet, basename="attempt")

urlpatterns = [path("me/", views.me), path("", include(router.urls))]
