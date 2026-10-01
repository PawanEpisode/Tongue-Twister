"""Twister catalogue filters shared by the list, the facet counts and Random."""

from types import SimpleNamespace

from django_filters import rest_framework as filters
from rest_framework.filters import SearchFilter

from .models import Twister

# Query parameter of each facet dimension, so faceting can drop exactly one.
FACET_PARAMS = {"levels": "difficulty", "categories": "category", "origins": "origin"}


class TwisterFilter(filters.FilterSet):
    category = filters.CharFilter(field_name="category__slug")
    difficulty = filters.NumberFilter()
    origin = filters.CharFilter()
    min_words = filters.NumberFilter(field_name="word_count", lookup_expr="gte")
    max_words = filters.NumberFilter(field_name="word_count", lookup_expr="lte")

    class Meta:
        model = Twister
        fields = ["category", "difficulty", "origin", "min_words", "max_words"]


class TwisterSearchFilter(SearchFilter):
    """`?search=` with `?q=` as an alias (same behaviour, `search` wins when both are sent)."""

    alias = "q"

    def get_search_terms(self, request):
        params = request.query_params
        value = params.get(self.search_param) or params.get(self.alias, "")
        return super().get_search_terms(SimpleNamespace(query_params={self.search_param: value}))
