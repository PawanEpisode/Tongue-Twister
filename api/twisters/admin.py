from django.contrib import admin

from .models import (
    Attempt,
    Category,
    DailyActivity,
    Favorite,
    FeatureFlag,
    Plan,
    PracticeSession,
    Profile,
    SyncBatch,
    Twister,
    UserPreference,
)


@admin.register(Twister)
class TwisterAdmin(admin.ModelAdmin):
    list_display = ["text", "difficulty", "origin", "category", "is_published"]
    list_filter = ["difficulty", "origin", "category", "is_published"]
    search_fields = ["text"]
    prepopulated_fields = {"slug": ("text",)}


admin.site.register([Category, Profile, Attempt, Favorite, Plan, UserPreference, PracticeSession, DailyActivity, SyncBatch, FeatureFlag])
