import base64
import hashlib
import hmac
import json
import time

from django.conf import settings

from .models import PharmacyUser, UserAccess


ROLE_PERMISSIONS = {
    "admin": [
        "dashboard", "medicines", "categories", "suppliers", "purchases", "stock",
        "sales", "customers", "prescriptions", "users", "reports", "notifications",
        "settings", "customers:write", "prescriptions:write", "sales:write",
        "medicines:opening-stock", "suppliers:write", "suppliers:archive",
        "purchases:write", "medicines:write", "medicines:archive",
        "categories:write", "categories:archive",
    ],
    "pharmacist": [
        "dashboard", "medicines", "categories", "prescriptions", "sales",
        "customers", "stock", "notifications", "customers:write",
        "prescriptions:write", "sales:write", "medicines:write",
        "medicines:archive", "categories:write", "categories:archive",
    ],
    "staff": ["dashboard", "medicines", "categories", "sales", "customers", "notifications", "customers:write", "sales:write", "medicines:write"],
    "pharmacy_assistant": ["dashboard", "medicines", "categories", "sales", "customers", "notifications", "customers:write", "sales:write", "medicines:write"],
    "cashier": ["dashboard", "sales", "customers", "notifications", "customers:write", "sales:write"],
    "store_keeper": ["dashboard", "stock", "purchases", "suppliers", "notifications", "suppliers:write", "suppliers:archive", "purchases:write"],
}


def permissions_for(role):
    return list(ROLE_PERMISSIONS.get(str(role).lower(), []))


def _b64encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_token(user):
    now = int(time.time())
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64encode(json.dumps({
        "id": user.pk,
        "email": user.email,
        "role": user.role,
        "iat": now,
        "exp": now + 7 * 24 * 60 * 60,
    }, separators=(",", ":")).encode())
    message = f"{header}.{payload}".encode("ascii")
    signature = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64encode(signature)}"


def decode_token(token):
    try:
        header, payload, signature = token.split(".")
        message = f"{header}.{payload}".encode("ascii")
        expected = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature)):
            return None
        decoded_header = json.loads(_b64decode(header))
        claims = json.loads(_b64decode(payload))
        if decoded_header.get("alg") != "HS256" or claims.get("exp", 0) <= int(time.time()):
            return None
        return claims
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def authenticate_token(token):
    claims = decode_token(token)
    if not claims or not isinstance(claims.get("id"), int):
        return None
    try:
        user = PharmacyUser.objects.get(pk=claims["id"])
        if user.access.status != UserAccess.Status.ACTIVE:
            return None
        return user
    except (PharmacyUser.DoesNotExist, UserAccess.DoesNotExist):
        return None
