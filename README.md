<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# FT Social Dashboard

Hệ thống phân tích tương tác mạng xã hội Facebook & Zalo OA chuyên nghiệp, kết nối đồng bộ Google Sheets tự động.

## 🚀 Khởi chạy nhanh bằng 1 dòng lệnh

Để cài đặt các thư viện cần thiết và khởi chạy ứng dụng ngay lập tức, hãy mở Terminal/Command Prompt trong thư mục dự án và chạy dòng lệnh duy nhất sau:

```bash
npm install && npm run dev
```

*Sau khi chạy thành công, ứng dụng sẽ hoạt động tại địa chỉ: **http://localhost:3000***

---

## ⚙️ Cấu hình ban đầu (Tùy chọn)

Nếu bạn muốn kết nối ổn định với Firestore Cloud hoặc Google Sheets vĩnh viễn:
1. Tạo một tệp `.env` dựa theo mẫu `.env.example` để khai báo các cấu hình API.
2. Vào giao diện **Cấu hình hệ thống** trong ứng dụng để liên kết Google Service Account JSON (giúp tự động đồng bộ Google Sheets không bị hết hạn token sau 1 giờ).

