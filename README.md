# FT Workspace

FT Workspace là hệ thống quản trị nội bộ của FermatTech, gồm frontend React/Vite và backend Django REST Framework.

Hệ thống sử dụng:

- React 19, Vite và Tailwind CSS cho giao diện.
- Django 5 và Django REST Framework cho backend.
- Django User và DRF Token Authentication để đăng nhập.
- PostgreSQL trên production.
- SQLite khi phát triển local.
- Nginx và Gunicorn trên VPS.

Hệ thống không sử dụng Firebase để đăng nhập hoặc lưu trữ dữ liệu.

---

## ⚡ Các lệnh nhanh (Một dòng lệnh)

Dự án hỗ trợ 3 lệnh nhanh bằng npm để chạy local, commit code và deploy VPS:

1. **Chạy local toàn bộ dự án (Frontend + Backend):**
   ```powershell
   npm start
   ```
   *Lệnh này tự động tạo môi trường ảo `.venv`, cài đặt dependencies cho cả backend và frontend, chạy migrations của PostgreSQL local, kiểm tra cấu hình và khởi động cả 2 server.*

2. **Commit và Push git nhanh:**
   ```powershell
   npm run git-push "Thông điệp commit của bạn"
   ```
   *Ví dụ: `npm run git-push "sửa lỗi giao diện"`. Lệnh này tự động chạy `git add .`, commit với thông điệp bạn nhập và push lên Github. Nếu không điền thông điệp commit, mặc định sẽ là "Auto update".*

3. **Commit, Push git và tự động cập nhật, reset server trên VPS:**
   ```powershell
   npm run deploy "Thông điệp commit của bạn"
   ```
   *Ví dụ: `npm run deploy "cập nhật tính năng"`. Lệnh này tự động: commit & push code lên GitHub ở máy local -> SSH vào VPS -> tự động pull code mới -> chạy script nâng cấp -> reset server Gunicorn/systemd trên VPS. (Cấu hình SSH VPS lấy từ file `.env` local của bạn).*

---


## Chạy local

### Yêu cầu

Máy tính cần cài sẵn:

- Node.js 22 trở lên.
- npm.
- Python 3.12 trở lên.
- Git.

### Chạy hệ thống bằng một câu lệnh

Mở Terminal hoặc PowerShell tại thư mục dự án và chạy:

```powershell
npm start
```

Không cần tạo môi trường Python, cài dependency, chạy migration hoặc mở hai cửa sổ Terminal riêng.

Lệnh `npm start` tự động thực hiện:

1. Tạo file `.env` nếu chưa tồn tại.
2. Tự sinh `DJANGO_SECRET_KEY`, mật khẩu Admin và `CRON_SECRET`.
3. Tạo môi trường Python `.venv`.
4. Cài dependency backend từ `backend/requirements.txt`.
5. Cài dependency frontend từ `package.json`.
6. Chạy Django migration.
7. Kiểm tra cấu hình Django.
8. Khởi động backend Django.
9. Khởi động frontend React.

Sau khi khởi động thành công:

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8000`
- Kiểm tra API: `http://127.0.0.1:8000/api/health`

### Tài khoản quản trị lần đầu

Khi file `.env` được tạo lần đầu, Terminal sẽ hiển thị:

```text
Tài khoản quản trị khởi tạo: admin@ftsocial.com
Mật khẩu quản trị khởi tạo: <mật khẩu tự sinh>
```

Hãy lưu lại mật khẩu này. Mật khẩu chỉ được hiển thị trong lần tạo `.env` đầu tiên.

### Dừng hệ thống

Nhấn:

```text
Ctrl + C
```

Frontend và backend sẽ cùng dừng.

### Chạy lại những lần sau

Vẫn chỉ cần chạy:

```powershell
npm start
```

Script chỉ cài lại dependency khi `package.json` hoặc `backend/requirements.txt` thay đổi.

---

## Cấu hình môi trường

File cấu hình được đặt tại:

```text
.env
```

Môi trường local mặc định sử dụng SQLite nên không cần cài PostgreSQL.

Các biến chính:

```env
DJANGO_DEBUG="true"
DJANGO_SECRET_KEY="chuoi-bi-mat"
DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1,workspace.fermat.vn"
CORS_ALLOWED_ORIGINS="http://localhost:5173,https://workspace.fermat.vn"
CSRF_TRUSTED_ORIGINS="https://workspace.fermat.vn"

ADMIN_EMAILS="admin@ftsocial.com"
BOOTSTRAP_ADMIN_EMAIL="admin@ftsocial.com"
BOOTSTRAP_ADMIN_PASSWORD="mat-khau-admin-ban-dau"
```

Cấu hình PostgreSQL trên production:

```env
DATABASE_URL="postgresql://ft_user:mat_khau@127.0.0.1:5432/ft_social_db"
```

Google Sheets sử dụng Service Account:

```env
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n","client_email":"..."}'
```

Không đưa file `.env`, mật khẩu, token hoặc Service Account lên GitHub.

---

## Kiểm tra dự án

Kiểm tra frontend:

```powershell
npm run lint
npm run build
```

Kiểm tra backend trên Windows:

```powershell
.\.venv\Scripts\python.exe backend\manage.py check
.\.venv\Scripts\python.exe backend\manage.py makemigrations --check --dry-run
```

Kiểm tra backend trên Linux hoặc macOS:

```bash
./.venv/bin/python backend/manage.py check
./.venv/bin/python backend/manage.py makemigrations --check --dry-run
```

---

## Cập nhật VPS bằng một câu lệnh

Dự án trên VPS được đặt tại:

```text
/var/www/ft-social-dashboard
```

Từ máy local, chạy:

```powershell
ssh root@103.142.27.69 "cd /var/www/ft-social-dashboard && git fetch origin main && git reset --hard origin/main && bash scripts/update-vps.sh"
```

Script tự động:

1. Đồng bộ mã nguồn mới nhất từ nhánh `main`.
2. Tạo `.venv` nếu chưa có.
3. Cài dependency backend.
4. Cài dependency frontend.
5. Kiểm tra TypeScript.
6. Build frontend.
7. Chạy Django migration.
8. Thu thập static files.
9. Kiểm tra cấu hình Django.
10. Khởi động lại dịch vụ Gunicorn.
11. Kiểm tra API `/api/health`.

VPS phải có file `.env` production trước khi chạy lệnh cập nhật.

Các biến mặc định của script:

```text
FT_BRANCH=main
FT_SERVICE_NAME=ft-workspace
FT_BIND_ADDRESS=127.0.0.1:8000
FT_GUNICORN_WORKERS=3
```

Có thể thay đổi khi cần, ví dụ:

```bash
FT_SERVICE_NAME=ft-social-dashboard bash scripts/update-vps.sh
```

---

## Tạo tài khoản quản trị thủ công

Windows:

```powershell
.\.venv\Scripts\python.exe backend\manage.py createsuperuser
```

Linux hoặc macOS:

```bash
./.venv/bin/python backend/manage.py createsuperuser
```

---

## Các lệnh thường dùng

```powershell
npm start
npm run git-push "Commit message"
npm run deploy "Commit message"
npm run lint
npm run build
```

- `npm start`: Tự chuẩn bị môi trường, chạy migrations và khởi động hệ thống local.
- `npm run git-push "msg"`: Commit toàn bộ thay đổi local và push lên Github qua 1 dòng lệnh.
- `npm run deploy "msg"`: Commit, push Github và SSH vào VPS để pull code và restart server qua 1 dòng lệnh.
- `npm run lint`: Kiểm tra lỗi TypeScript.
- `npm run build`: Build frontend production ở local.

