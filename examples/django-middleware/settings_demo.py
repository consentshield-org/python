# Minimal Django settings for running the consent-middleware demo.
#
#   CS_API_KEY=cs_live_... CS_PROPERTY_ID=PROP_UUID \
#       DJANGO_SETTINGS_MODULE=examples.django_middleware.settings_demo \
#       python -m django runserver 0.0.0.0:8000

from __future__ import annotations

import os

DEBUG = True
SECRET_KEY = "dev-only-not-for-production"  # noqa: S105 - example only
ALLOWED_HOSTS = ["*"]
ROOT_URLCONF = "examples.django_middleware.urls"

INSTALLED_APPS: list[str] = []

MIDDLEWARE = [
    "django.middleware.common.CommonMiddleware",
    "examples.django_middleware.consent_middleware.ConsentMiddleware",
]

CONSENTSHIELD = {
    "API_KEY": os.environ.get("CS_API_KEY", ""),
    "PROPERTY_ID": os.environ.get("CS_PROPERTY_ID", ""),
    "ROUTES": [
        {
            "path_prefix": "/api/marketing/send",
            "purpose_code": "marketing",
            "identifier_type": "email",
            "identifier_field": "email",
        },
    ],
}

DATABASES: dict[str, dict[str, str]] = {}
