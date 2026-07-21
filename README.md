# FT Social Dashboard

FT Workspace gồm frontend React/Vite và backend Django REST Framework. Hệ thống không sử dụng Firebase cho đăng nhập hoặc lưu trữ dữ liệu.

## Kiến trúc

- Frontend: React 19, Vite, Tailwind CSS.
- Backend: Django 5, Django REST Framework.
- Xác thực: Django User + DRF Token Authentication.
- Dữ liệu: PostgreSQL trong production; SQLite có thể dùng khi phát triển local.
- Tích hợp: Facebook Graph API, Zalo OA, Google Sheets và Gemini.

## Chạy local

### 1. Backend Django

```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
python backend\manage.py migrate
python backend\manage.py runserver 127.0.0.1:8000
```

Khi cơ sở dữ liệu chưa có tài khoản, khai báo `BOOTSTRAP_ADMIN_EMAIL` và `BOOTSTRAP_ADMIN_PASSWORD` trong `.env`. Đăng nhập lần đầu sẽ tạo tài khoản quản trị Django và sau đó không tự tạo lại.

### 2. Frontend React

Mở cửa sổ PowerShell khác:

```powershell
npm install
npm run dev
```

Vite chuyển tiếp `/api` và `/uploads` tới Django tại `127.0.0.1:8000`.

## Kiểm tra trước khi triển khai

```powershell
npm run lint
npm run build
python backend\manage.py check
python backend\manage.py makemigrations --check --dry-run
```

## Triển khai VPS

Quy trình khuyến nghị:

1. Nginx phục vụ thư mục `dist` của Vite.
2. Nginx chuyển tiếp `/api/` và `/uploads/` tới Gunicorn.
3. Gunicorn chạy `ft_backend.wsgi:application` với thư mục làm việc là `backend`.
4. Chạy `python backend/manage.py migrate` sau mỗi lần cập nhật model.
5. Lưu biến môi trường production ngoài Git và đặt `DJANGO_DEBUG=false`.

Ví dụ lệnh chạy Gunicorn:

```bash
cd /var/www/ft-social-dashboard/backend
../.venv/bin/gunicorn ft_backend.wsgi:application --bind 127.0.0.1:8000 --workers 3
```

## Tạo quản trị viên thủ công

```powershell
python backend\manage.py createsuperuser
```

Email quản trị cũng có thể được khai báo trong `ADMIN_EMAILS`. Không sử dụng tài khoản hoặc token giả trong production.
