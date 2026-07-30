from rest_framework import permissions


MODULE_PATHS = {
    "examination": "/api/examination",
    "digital-training": "/api/digital-training",
    "email-builder": "/api/email-",
    "attendance": "/api/attendance",
}


def requested_module(request):
    path = str(getattr(request, "path", "") or "")
    for module, prefix in MODULE_PATHS.items():
        if path.startswith(prefix):
            return module
    if path.startswith("/api/") and not path.startswith("/api/auth/") and not path.startswith("/api/admin/") and not path.startswith("/api/system-config") and not path.startswith("/api/health") and not path.startswith("/api/setup/") and not path.startswith("/api/upload"):
        return "social-dashboard"
    return None


def request_role(request) -> str:
    user = getattr(request, "user", None)
    return str(getattr(request, "user_role", "") or getattr(user, "role", "EMPLOYEE") or "EMPLOYEE")


def request_modules(request) -> set[str]:
    user = getattr(request, "user", None)
    modules = getattr(request, "access_modules", None)
    if modules is None:
        modules = getattr(user, "access_modules", None)
    return set(modules or [])


def has_module_access(request) -> bool:
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "email", ""):
        return False
    if request_role(request) == "ADMIN":
        return True
    module = requested_module(request)
    return module is None or module == "attendance" or module in request_modules(request)


class IsAuthenticated(permissions.BasePermission):
    """Authenticated, module-scoped access. Admin always has all modules."""
    def has_permission(self, request, view):
        return has_module_access(request)


class IsAuthenticatedOrReadOnly(permissions.BasePermission):
    """Public read access for normal workspace data; all mutations require authentication."""
    def has_permission(self, request, view):
        return request.method in permissions.SAFE_METHODS or has_module_access(request)

class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user is not None and request_role(request) == 'ADMIN'


class IsManagerOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user is not None
            and request_role(request) in ['ADMIN', 'MANAGER']
            and has_module_access(request)
        )
