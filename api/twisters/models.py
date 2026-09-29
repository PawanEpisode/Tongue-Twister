import uuid

from django.db import models


class Difficulty(models.IntegerChoices):
    EASY = 1, "Easy"
    MEDIUM = 2, "Medium"
    HARD = 3, "Hard"
    INSANE = 4, "Insane"


class Origin(models.TextChoices):
    CLASSIC = "classic", "Classic"
    MODERN = "modern", "Modern"


class Category(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=60)
    emoji = models.CharField(max_length=8, blank=True)
    description = models.CharField(max_length=200, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Twister(models.Model):
    slug = models.SlugField(unique=True, max_length=80)
    text = models.TextField()
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="twisters")
    difficulty = models.PositiveSmallIntegerField(choices=Difficulty.choices, default=Difficulty.EASY, db_index=True)
    origin = models.CharField(max_length=10, choices=Origin.choices, default=Origin.CLASSIC, db_index=True)
    tip = models.CharField(max_length=240, blank=True, help_text="Coaching hint shown before practice")
    focus_sounds = models.JSONField(default=list, blank=True, help_text='e.g. ["s", "sh"]')
    word_count = models.PositiveSmallIntegerField(editable=False, default=0)
    is_published = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["difficulty", "id"]

    def save(self, *args, **kwargs):
        self.word_count = len(self.text.split())
        super().save(*args, **kwargs)

    def __str__(self):
        return self.text[:60]


class Profile(models.Model):
    """One row per Supabase auth user. `id` is the Supabase `sub` claim."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(blank=True)
    display_name = models.CharField(max_length=40, blank=True)
    avatar_emoji = models.CharField(max_length=8, default="🗣️")
    xp = models.PositiveIntegerField(default=0)
    current_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    last_practice_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # DRF compatibility: behave like an authenticated user object.
    is_authenticated = True
    is_anonymous = False

    def __str__(self):
        return self.display_name or str(self.id)

    @property
    def level(self) -> int:
        return 1 + self.xp // 200


class Attempt(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="attempts")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="attempts")
    transcript = models.TextField(blank=True)
    accuracy = models.FloatField(help_text="0..1, server-computed")
    duration_ms = models.PositiveIntegerField()
    wpm = models.FloatField()
    score = models.PositiveSmallIntegerField(db_index=True)
    xp_awarded = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["twister", "-score"]), models.Index(fields=["profile", "-created_at"])]


class Favorite(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="favorites")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["profile", "twister"], name="uniq_favorite")]
