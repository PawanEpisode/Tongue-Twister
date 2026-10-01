from django.contrib import admin, messages
from django.utils import timezone

from .account import deletion
from .media import moderation, shares
from .models import (
    Achievement,
    AcousticModelVersion,
    Attempt,
    AttemptFeedback,
    AttemptPhoneme,
    AttemptWord,
    Category,
    DailyActivity,
    DailyTwister,
    Favorite,
    FeatureFlag,
    LeaderboardEntry,
    MediaAsset,
    MediaJob,
    ModerationReport,
    Plan,
    PracticeSession,
    Profile,
    Recording,
    ReportStatus,
    ScoringJob,
    ScoringProfile,
    ShareLink,
    StorageLedger,
    SyncBatch,
    Twister,
    TwisterPronunciation,
    UserAchievement,
    UserConsent,
    UserPhonemeStat,
    UserPreference,
    UserTwisterStats,
    UserWordStat,
)


@admin.register(Twister)
class TwisterAdmin(admin.ModelAdmin):
    list_display = ["text", "difficulty", "origin", "category", "is_published", "visibility"]
    list_filter = ["difficulty", "origin", "category", "is_published", "visibility"]
    search_fields = ["text"]
    raw_id_fields = ["owner"]
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


class ReadOnlyAdmin(admin.ModelAdmin):
    """Audit tables (ledger, consent log): visible to staff, never editable or deletable here."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(StorageLedger)
class StorageLedgerAdmin(ReadOnlyAdmin):
    list_display = ["created_at", "profile", "kind", "reason", "delta_bytes"]
    list_filter = ["kind", "reason"]
    raw_id_fields = ["profile", "asset"]


@admin.register(UserConsent)
class UserConsentAdmin(ReadOnlyAdmin):
    list_display = ["granted_at", "profile", "type", "version", "revoked_at"]
    list_filter = ["type", "version"]
    raw_id_fields = ["profile"]


@admin.register(MediaAsset)
class MediaAssetAdmin(ReadOnlyAdmin):
    list_display = ["created_at", "kind", "status", "size_bytes", "profile"]
    list_filter = ["kind", "status"]
    raw_id_fields = ["profile"]


@admin.register(MediaJob)
class MediaJobAdmin(ReadOnlyAdmin):
    """Worker queue, for diagnosing stuck or failing jobs."""

    list_display = [
        "created_at",
        "kind",
        "status",
        "tries",
        "max_tries",
        "locked_until",
        "error_code",
    ]
    list_filter = ["kind", "status"]
    raw_id_fields = ["recording", "asset"]


@admin.register(Recording)
class RecordingAdmin(admin.ModelAdmin):
    list_display = [
        "created_at",
        "title",
        "profile",
        "status",
        "size_bytes",
        "hidden_at",
        "deleted_at",
    ]
    list_filter = ["status", "layout", "visibility"]
    search_fields = ["title", "profile__email"]
    raw_id_fields = [
        "profile",
        "twister",
        "session",
        "attempt",
        "video_asset",
        "thumbnail_asset",
        "captions_asset",
    ]
    readonly_fields = ["created_at", "client_recording_id"]
    actions = ["hide", "unhide"]

    @admin.action(description="Hide selected recordings (and hold their share links)")
    def hide(self, request, queryset):
        now = timezone.now()
        for recording in queryset:
            shares.hold_for_target("recording", recording.pk)
        self.message_user(
            request,
            f"Hid {queryset.filter(hidden_at__isnull=True).update(hidden_at=now)} recordings.",
        )

    @admin.action(description="Unhide selected recordings")
    def unhide(self, request, queryset):
        self.message_user(request, f"Unhid {queryset.update(hidden_at=None)} recordings.")


@admin.register(ShareLink)
class ShareLinkAdmin(admin.ModelAdmin):
    """The token hash is deliberately not shown: staff can revoke or hold a link but never see or rebuild it."""

    list_display = [
        "created_at",
        "target_type",
        "target_id",
        "expires_at",
        "revoked_at",
        "hidden_at",
        "view_count",
    ]
    list_filter = ["target_type"]
    exclude = ["token_hash"]
    readonly_fields = [
        "target_type",
        "target_id",
        "created_by",
        "view_count",
        "last_viewed_at",
        "created_at",
    ]
    actions = ["revoke", "hold", "release"]

    def has_add_permission(self, request):
        return False

    @admin.action(description="Revoke selected links")
    def revoke(self, request, queryset):
        for link in queryset:
            shares.revoke(link)

    @admin.action(description="Hide (moderation hold) selected links")
    def hold(self, request, queryset):
        queryset.filter(hidden_at__isnull=True).update(hidden_at=timezone.now())

    @admin.action(description="Release moderation hold")
    def release(self, request, queryset):
        queryset.update(hidden_at=None)


@admin.register(ModerationReport)
class ModerationReportAdmin(admin.ModelAdmin):
    """The moderation queue: open reports first; resolve with the actions below."""

    list_display = ["created_at", "status", "reason", "share_link", "reporter", "resolved_by"]
    list_filter = ["status", "reason"]
    raw_id_fields = ["reporter", "share_link"]
    readonly_fields = ["reporter_ip_hash", "created_at", "resolved_at", "resolved_by"]
    actions = ["dismiss_reports", "action_reports"]

    def get_queryset(self, request):
        return super().get_queryset(request).order_by("status", "-created_at")

    @admin.action(description="Dismiss selected reports (link returns if under the threshold)")
    def dismiss_reports(self, request, queryset):
        rows = list(queryset.filter(status=ReportStatus.OPEN).select_related("share_link"))
        for row in rows:
            moderation.dismiss(row, request.user.get_username())
        self.message_user(request, f"Dismissed {len(rows)} reports.", messages.SUCCESS)

    @admin.action(description="Action selected reports (hide the link and the recording)")
    def action_reports(self, request, queryset):
        rows = list(queryset.filter(status=ReportStatus.OPEN).select_related("share_link"))
        for row in rows:
            moderation.action(row, request.user.get_username())
        self.message_user(request, f"Actioned {len(rows)} reports.", messages.SUCCESS)


admin.site.register(
    [
        Category,
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


class DeletionStateFilter(admin.SimpleListFilter):
    title = "deletion"
    parameter_name = "deletion"

    def lookups(self, request, model_admin):
        return [("pending", "Pending deletion")]

    def queryset(self, request, queryset):
        return queryset.pending_deletion() if self.value() == "pending" else queryset


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["id", "email", "display_name", "plan", "night_owl", "deletion_scheduled_for"]
    list_filter = ["plan", "night_owl", DeletionStateFilter]
    search_fields = ["email", "display_name", "id"]
    readonly_fields = ["deletion_requested_at", "deletion_scheduled_for"]
    actions = ["cancel_deletion"]

    @admin.action(description="Cancel pending deletion (support request)")
    def cancel_deletion(self, request, queryset):
        pending = list(queryset.pending_deletion())
        for profile in pending:
            deletion.cancel_deletion(profile)
        self.message_user(request, f"Cancelled {len(pending)} deletions.", messages.SUCCESS)


@admin.register(Achievement)
class AchievementAdmin(admin.ModelAdmin):
    """Edits here are overwritten by the next `sync_achievements`: the catalogue in code is the source
    of truth. Use the admin for a quick hotfix (hide or deactivate a badge), then change the code."""

    list_display = ["code", "name", "tier", "category", "xp_reward", "verified_only", "active"]
    list_filter = ["tier", "category", "active", "verified_only"]
    search_fields = ["code", "name"]


@admin.register(UserAchievement)
class UserAchievementAdmin(ReadOnlyAdmin):
    """Unlocks are facts: the only staff decision is to revoke one (PRD 05 edge 2). A revoked row keeps
    its slot, so the engine never re-grants it."""

    list_display = ["unlocked_at", "profile", "achievement", "revoked", "seen"]
    list_filter = ["revoked", "achievement__tier"]
    raw_id_fields = ["profile"]
    actions = ["revoke"]

    @admin.action(description="Revoke selected achievements")
    def revoke(self, request, queryset):
        self.message_user(
            request, f"Revoked {queryset.filter(revoked=False).update(revoked=True)}."
        )


@admin.register(DailyTwister)
class DailyTwisterAdmin(admin.ModelAdmin):
    """A row for a day *is* the editorial override; days without one fall back to the automatic pick
    (which is saved the first time the day is requested)."""

    list_display = ["day", "twister", "source", "locked_at"]
    list_filter = ["source"]
    raw_id_fields = ["twister"]
    date_hierarchy = "day"


@admin.register(LeaderboardEntry)
class LeaderboardEntryAdmin(ReadOnlyAdmin):
    """Materialised by `build_leaderboard`; edits would be overwritten within the hour."""

    list_display = ["week_start", "twister", "rank", "best_score", "profile", "built_at"]
    list_filter = ["week_start"]
    raw_id_fields = ["profile", "twister", "best_attempt"]
