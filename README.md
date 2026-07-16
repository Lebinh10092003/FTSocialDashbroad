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
