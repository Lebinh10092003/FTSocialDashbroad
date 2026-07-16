# FT Social Dashboard

Hệ thống phân tích tương tác Facebook và Zalo OA, đồng bộ dữ liệu sang Google Sheets.

## Kiến trúc

- Frontend: React 19 + Vite.
- Backend: Express + TypeScript, chạy trong `server.ts`.
- API: các endpoint dưới prefix `/api`.
- Database: Firestore khi có Firebase Admin credentials; nếu không có credentials thì dùng LocalDb trong `server/data`.
- Deployment: frontend có thể chạy trên GitHub Pages; backend chạy độc lập bằng Docker, Cloud Run, Render hoặc một Node server.

## Chạy local

Trên Windows PowerShell, dùng `npm.cmd` nếu PowerShell chặn `npm.ps1`:

```powershell
cd C:\FermatTech\FTSocialDashbroad-main
npm.cmd install
npm.cmd run dev
```

Mở <http://localhost:3000> và đăng nhập local bằng:

```text
Tên đăng nhập: admin
Mật khẩu: Admin123
```

Tài khoản này là mock login dành cho môi trường phát triển. Dashboard, bài viết và báo cáo sẽ đọc dữ liệu mẫu từ `server/data`.

Các lệnh kiểm tra:

```powershell
npm.cmd run lint
npm.cmd run build
```

Kiểm tra backend:

```powershell
Invoke-WebRequest http://localhost:3000/api/health
```

## Cấu hình backend

Tạo `.env` từ [.env.example](.env.example) khi cần dùng dữ liệu thật:

```powershell
Copy-Item .env.example .env
```

Các biến quan trọng:

- `PORT`: cổng HTTP; mặc định `3000`. Cloud Run/Render sẽ tự cấp biến này.
- `CORS_ORIGIN`: danh sách origin frontend được phép gọi API, phân tách bằng dấu phẩy. Không thêm path vào origin.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase Admin credential để xác thực Firebase và dùng Firestore thật.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: service account dùng cho Google Sheets.
- `META_PAGE_TOKENS_JSON`: access token Facebook Page.
- `ZALO_OA_TOKENS_JSON`: access token Zalo OA.
- `ADMIN_EMAILS`: email được cấp quyền ADMIN.
- `CRON_SECRET`: secret bảo vệ endpoint đồng bộ định kỳ.

Trong môi trường cloud, nên cấu hình Firebase/Firestore để dữ liệu bền vững. LocalDb ghi file trong container và có thể mất dữ liệu khi container được thay mới.

## Chạy backend bằng Docker

Build và chạy toàn bộ ứng dụng (frontend + backend cùng origin):

```powershell
docker build -t ft-social-dashboard .
docker run --rm -p 3000:3000 --env-file .env ft-social-dashboard
```

Mở <http://localhost:3000>. Dockerfile đã dùng `PORT` của môi trường cloud và chạy file production `dist/server.cjs`.

## Deploy backend

Có thể deploy repository này như một Docker Web Service trên Render/Railway hoặc Cloud Run.

Ví dụ Cloud Run:

```bash
gcloud run deploy ft-social-dashboard-api \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated
```

Sau khi deploy, kiểm tra URL backend:

```text
https://YOUR_BACKEND_DOMAIN/api/health
```

Backend cần được phép truy cập công khai ở tầng HTTP vì frontend GitHub Pages phải gọi được API. Quyền truy cập dữ liệu vẫn được kiểm soát bằng Firebase ID token và role ADMIN/VIEWER trong backend.

## Triển khai lên VPS chỉ bằng 1 câu lệnh (1-Click Deploy)

Hệ thống hỗ trợ cơ chế deploy tự động cực kỳ nhanh chóng từ máy local lên VPS thông qua giao thức SSH & SFTP bảo mật. Toàn bộ quy trình từ build, đóng gói, upload, giải nén, cài đặt dependency và khởi chạy PM2 trên VPS sẽ được thực thi qua **1 câu lệnh duy nhất**.

Đặc biệt, hệ thống được tích hợp **cơ chế tự động phát hiện và chuyển cổng khi bị chiếm**. Nếu cổng mặc định (như 3000 hoặc 5174) đang có dự án khác trên VPS sử dụng, server sẽ tự động tìm kiếm và lắng nghe ở cổng trống tiếp theo (ví dụ: 5175, 5176...), đảm bảo không ảnh hưởng đến các dự án khác. Sau khi deploy thành công, terminal local sẽ in ra chính xác địa chỉ IP và cổng đang hoạt động của ứng dụng.

### Bước 1: Cấu hình thông tin VPS
Mở file `.env` ở thư mục gốc và điền các thông tin VPS của bạn ở cuối file:

```env
# IP hoặc domain của VPS
DEPLOY_HOST="123.45.67.89"
# Cổng SSH của VPS (mặc định là 22)
DEPLOY_PORT="22"
# Tài khoản SSH (thường là root)
DEPLOY_USER="root"
# Mật khẩu SSH (để trống nếu dùng SSH Key)
DEPLOY_PASSWORD="your_vps_ssh_password"
# Đường dẫn tới SSH Private Key ở local (để trống nếu dùng mật khẩu)
DEPLOY_KEY_PATH=""
# Thư mục triển khai ứng dụng trên VPS
DEPLOY_PATH="/var/www/ft-social-dashboard"
```

### Bước 2: Thực thi Deploy

Bạn có thể chạy deploy trực tiếp bằng 1 câu lệnh tùy theo hệ điều hành:

- **Trên Windows**: 
  Chỉ cần click đúp chuột vào file [deploy.bat](deploy.bat) ở thư mục gốc (hoặc mở CMD/PowerShell gõ `deploy.bat`).
  
- **Trên Linux / macOS**:
  Mở terminal tại thư mục gốc và chạy:
  ```bash
  chmod +x deploy.sh
  ./deploy.sh
  ```
  
- **Hoặc sử dụng npm**:
  ```bash
  npm run deploy
  ```

Sau khi chạy, ứng dụng sẽ được build và tự động tải lên VPS. Script sẽ tự động quét log khởi động trên VPS và hiển thị đường dẫn URL truy cập chứa cổng rảnh thực tế cho bạn trên màn hình máy local.

## Kết nối GitHub Pages với backend

Frontend GitHub Pages được build tĩnh, nên `VITE_API_URL` phải được cung cấp tại thời điểm build.

Vào repository GitHub:

`Settings → Secrets and variables → Actions → Variables → New repository variable`

Tạo biến:

```text
Name:  VITE_API_URL
Value: https://YOUR_BACKEND_DOMAIN
```

Không thêm dấu `/` cuối URL. Workflow `.github/workflows/deploy-pages.yml` sẽ dùng biến này khi chạy `vite build`; nếu thiếu biến, workflow sẽ dừng với thông báo rõ ràng.

Ở backend, đặt:

```text
CORS_ORIGIN=https://YOUR_ACCOUNT.github.io
```

Nếu GitHub Pages dùng custom domain, đặt `CORS_ORIGIN` bằng origin custom domain tương ứng. Sau khi cấu hình, push một commit hoặc chạy workflow bằng `workflow_dispatch` để build lại frontend.

## Một số endpoint chính

```text
GET  /api/health
GET  /api/auth/me
GET  /api/dashboard
GET  /api/channels
POST /api/sync/all
GET  /api/posts
GET  /api/reports/export.csv
```
