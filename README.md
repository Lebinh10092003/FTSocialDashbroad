# FT Social Dashboard

Hệ thống phân tích tương tác Facebook và Zalo OA, đồng bộ dữ liệu sang Google Sheets.

## 1. Chạy local trên 1 dòng (Windows PowerShell)

```powershell

```

## 2. Cập nhật & Reset VPS qua Git Pull bằng 1 dòng SSH (Chạy tại máy local - Tự động sửa lỗi xung đột file trên VPS)

```powershell
ssh root@103.142.27.69 "cd /var/www/ft-social-dashboard && (git status >/dev/null 2>&1 || (git init && git remote add origin https://github.com/Lebinh10092003/FTSocialDashbroad.git && git fetch && git checkout -f main)) && git reset --hard && git pull && npm install && npm run build && pm2 restart all"
```

## 3. Build & Deploy trực tiếp từ local lên VPS qua 1 dòng script (Chạy tại máy local)

```powershell
npm run deploy
```

## 4. Git Commit & Push nhanh trên 1 dòng (Windows PowerShell)

```powershell
git add .; git commit -m "update"; git push origin
```
