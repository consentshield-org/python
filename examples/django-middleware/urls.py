# Demo URLconf for the Django middleware example. Wire into your
# project's root urls.py with `path("", include("examples.django_middleware.urls"))`.

from __future__ import annotations

from django.http import HttpRequest, JsonResponse
from django.urls import path


def send_marketing(request: HttpRequest) -> JsonResponse:
    # By the time this view runs, ConsentMiddleware has already
    # confirmed `granted` for the recipient on the marketing purpose.
    # The X-CS-Evaluated-At header is on the response for end-to-end
    # correlation.
    import json

    body = json.loads(request.body.decode("utf-8")) if request.body else {}
    return JsonResponse({"sent": True, "recipient": body.get("email")})


urlpatterns = [
    path("api/marketing/send", send_marketing, name="send_marketing"),
]
