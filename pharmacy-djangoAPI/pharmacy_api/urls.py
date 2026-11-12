from django.urls import re_path

from .views import api_dispatch

urlpatterns = [
    re_path(r"^(?P<route>.*)$", api_dispatch),
]
