# FT Social Dashboard

Hệ thống phân tích tương tác Facebook và Zalo OA, đồng bộ dữ liệu sang Google Sheets.

## 1. Chạy local trên 1 dòng (Windows PowerShell)

```powershell
npm install; npm run dev
```

## 2. Cập nhật & Reset trực tiếp trên VPS qua Git Pull trên 1 dòng (Thực thi trên VPS)

```bash
cd /var/www/ft-social-dashboard && git pull && npm install --omit=dev && pm2 restart all
```

## 3. Cập nhật & Reset VPS từ xa qua SSH trên 1 dòng (Thực thi tại máy local)

```powershell
ssh root@103.142.27.69 "cd /var/www/ft-social-dashboard && git pull && npm install --omit=dev && pm2 restart all"
```
