from django.contrib import admin

from .models import (
    AcousticModelVersion,
    Attempt,
    AttemptFeedback,
    AttemptPhoneme,
    AttemptWord,
    Category,
    DailyActivity,
    Favorite,
    FeatureFlag,
    Plan,
    PracticeSession,
    Profile,
    ScoringJob,
    ScoringProfile,
    SyncBatch,
    Twister,
    TwisterPronunciation,
    UserPhonemeStat,
    UserPreference,
    UserTwisterStats,
    UserWordStat,
)


@admin.register(Twister)
class TwisterAdmin(admin.ModelAdmin):
    list_display = ["text", "difficulty", "origin", "category", "is_published"]
    list_filter = ["difficulty", "origin", "category", "is_published"]
    search_fields = ["text"]
    prepopulated_fields = {"slug": ("text",)}


class AttemptWordInline(admin.TabularInline):
    model = AttemptWord
    extra = 0
    can_delete = False
    show_change_link = True


@admin.register(Attempt)
class AttemptAdmin(admin.ModelAdmin):
    list_display = [
        "created_at",
        "twister",
        "kind",
        "score",
        "score_version",
        "engine",
        "verification_status",
        "flagged",
    ]
    list_filter = ["kind", "engine", "verification_status", "flagged", "score_version"]
    raw_id_fields = ["profile", "twister", "session"]
    readonly_fields = ["public_id", "created_at"]
    inlines = [AttemptWordInline]


@admin.register(TwisterPronunciation)
class TwisterPronunciationAdmin(admin.ModelAdmin):
    list_display = ["word", "twister", "accent", "respelling", "source"]
    list_filter = ["source", "accent"]
    search_fields = ["word"]
    raw_id_fields = ["twister"]


@admin.register(AcousticModelVersion)
class AcousticModelVersionAdmin(admin.ModelAdmin):
    list_display = ["name", "quantization", "size_bytes", "active", "released_at"]
    list_filter = ["active", "quantization"]


@admin.register(ScoringJob)
class ScoringJobAdmin(admin.ModelAdmin):
    list_display = ["created_at", "kind", "status", "tries", "attempt"]
    list_filter = ["kind", "status"]
    raw_id_fields = ["attempt"]


admin.site.register(
    [
        Category,
        Profile,
        Favorite,
        Plan,
        UserPreference,
        PracticeSession,
        DailyActivity,
        SyncBatch,
        FeatureFlag,
        AttemptPhoneme,
        AttemptFeedback,
        UserWordStat,
        UserPhonemeStat,
        UserTwisterStats,
        ScoringProfile,
    ]
)
