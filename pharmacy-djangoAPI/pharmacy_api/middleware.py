from django.conf import settings
from django.http import HttpResponse

from .auth import authenticate_token


class ApiCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "OPTIONS" and request.path.startswith("/api/"):
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)
        origin = request.headers.get("Origin")
        if origin in settings.CORS_ALLOWED_ORIGINS:
            response["Access-Control-Allow-Origin"] = origin
            response["Vary"] = "Origin"
            response["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, OPTIONS"
        return response


class BearerAuthenticationMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.pharmacy_user = None
        authorization = request.headers.get("Authorization", "")
        if authorization.startswith("Bearer "):
            request.pharmacy_user = authenticate_token(authorization[7:])
        return self.get_response(request)
