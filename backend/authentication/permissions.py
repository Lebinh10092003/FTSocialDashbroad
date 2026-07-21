from rest_framework import permissions

class IsAuthenticated(permissions.BasePermission):
    def has_permission(self, request, view):
        # Cho phép xem dữ liệu (các phương thức đọc như GET, HEAD, OPTIONS)
        if request.method in permissions.SAFE_METHODS:
            return True
        # Các phương thức sửa đổi dữ liệu (POST, PUT, PATCH, DELETE) bắt buộc phải đăng nhập
        from .models import UserProfile
        return request.user is not None and isinstance(request.user, UserProfile)


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user is not None and getattr(request, 'user_role', 'EMPLOYEE') == 'ADMIN'

class IsManagerOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user is not None and getattr(request, 'user_role', 'EMPLOYEE') in ['ADMIN', 'MANAGER']
