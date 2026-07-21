from rest_framework import permissions

class IsAuthenticated(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user is not None

class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user is not None and getattr(request, 'user_role', 'EMPLOYEE') == 'ADMIN'

class IsManagerOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user is not None and getattr(request, 'user_role', 'EMPLOYEE') in ['ADMIN', 'MANAGER']
