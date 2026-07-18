export interface EmailIconOption {
  name: string;
  label: string;
  category: 'general' | 'education' | 'communication' | 'business' | 'status' | 'time' | 'location' | 'media';
}

const icon = (name: string, label: string, category: EmailIconOption['category']): EmailIconOption => ({ name, label, category });

/** Curated from Lucide: broad enough for common email illustrations without rendering the entire package at once. */
export const EMAIL_ICON_LIBRARY: EmailIconOption[] = [
  icon('CircleCheck', 'Hoàn thành', 'status'), icon('BadgeCheck', 'Đã xác nhận', 'status'), icon('Check', 'Dấu kiểm', 'status'),
  icon('CircleAlert', 'Cảnh báo', 'status'), icon('TriangleAlert', 'Cảnh báo tam giác', 'status'), icon('Info', 'Thông tin', 'status'),
  icon('CircleQuestionMark', 'Trợ giúp', 'status'), icon('CircleX', 'Không đạt', 'status'), icon('ShieldCheck', 'Bảo mật', 'status'),
  icon('Star', 'Ngôi sao', 'general'), icon('Sparkles', 'Nổi bật', 'general'), icon('Heart', 'Yêu thích', 'general'),
  icon('Gift', 'Quà tặng', 'general'), icon('Award', 'Giải thưởng', 'general'), icon('Trophy', 'Cúp thành tích', 'general'),
  icon('Medal', 'Huy chương', 'general'), icon('Crown', 'Vương miện', 'general'), icon('Flag', 'Cờ đánh dấu', 'general'),
  icon('Lightbulb', 'Ý tưởng', 'education'), icon('BookOpen', 'Sách mở', 'education'), icon('BookMarked', 'Tài liệu', 'education'),
  icon('GraduationCap', 'Tốt nghiệp', 'education'), icon('School', 'Trường học', 'education'), icon('NotebookPen', 'Ghi chép', 'education'),
  icon('Pencil', 'Bút viết', 'education'), icon('Brain', 'Tư duy', 'education'), icon('Microscope', 'Khoa học', 'education'),
  icon('Atom', 'Nguyên tử', 'education'), icon('FlaskConical', 'Thí nghiệm', 'education'), icon('Calculator', 'Toán học', 'education'),
  icon('Languages', 'Ngôn ngữ', 'education'), icon('Library', 'Thư viện', 'education'), icon('Presentation', 'Bài giảng', 'education'),
  icon('Mail', 'Email', 'communication'), icon('Send', 'Gửi đi', 'communication'), icon('MessageCircle', 'Tin nhắn', 'communication'),
  icon('Phone', 'Điện thoại', 'communication'), icon('Bell', 'Thông báo', 'communication'), icon('Megaphone', 'Loa thông báo', 'communication'),
  icon('Users', 'Nhóm người', 'communication'), icon('User', 'Cá nhân', 'communication'), icon('UserCheck', 'Người đã xác nhận', 'communication'),
  icon('BriefcaseBusiness', 'Công việc', 'business'), icon('Building2', 'Tổ chức', 'business'), icon('Landmark', 'Đơn vị', 'business'),
  icon('WalletCards', 'Thanh toán', 'business'), icon('CreditCard', 'Thẻ', 'business'), icon('ReceiptText', 'Hóa đơn', 'business'),
  icon('ShoppingCart', 'Giỏ hàng', 'business'), icon('Package', 'Sản phẩm', 'business'), icon('Tag', 'Nhãn', 'business'),
  icon('ChartColumn', 'Biểu đồ', 'business'), icon('TrendingUp', 'Tăng trưởng', 'business'), icon('Target', 'Mục tiêu', 'business'),
  icon('CalendarDays', 'Lịch', 'time'), icon('CalendarCheck', 'Lịch xác nhận', 'time'), icon('Clock3', 'Thời gian', 'time'),
  icon('AlarmClock', 'Nhắc lịch', 'time'), icon('Timer', 'Đếm giờ', 'time'), icon('Hourglass', 'Thời hạn', 'time'),
  icon('MapPin', 'Địa điểm', 'location'), icon('Map', 'Bản đồ', 'location'), icon('Navigation', 'Điều hướng', 'location'),
  icon('Globe', 'Quốc tế', 'location'), icon('Plane', 'Máy bay', 'location'), icon('Bus', 'Xe buýt', 'location'),
  icon('House', 'Trang chủ', 'location'), icon('Building', 'Tòa nhà', 'location'), icon('LocateFixed', 'Vị trí', 'location'),
  icon('Image', 'Hình ảnh', 'media'), icon('Camera', 'Máy ảnh', 'media'), icon('Video', 'Video', 'media'),
  icon('CirclePlay', 'Phát video', 'media'), icon('Music2', 'Âm thanh', 'media'), icon('FileText', 'Tệp văn bản', 'media'),
  icon('Download', 'Tải xuống', 'media'), icon('Upload', 'Tải lên', 'media'), icon('Link', 'Liên kết', 'media'),
  icon('Rocket', 'Khởi động', 'general'), icon('Zap', 'Nhanh chóng', 'general'), icon('Smile', 'Hài lòng', 'general'),
];

export const EMAIL_ICON_CATEGORY_LABELS: Record<EmailIconOption['category'], string> = {
  general: 'Phổ biến', education: 'Giáo dục', communication: 'Liên lạc', business: 'Kinh doanh',
  status: 'Trạng thái', time: 'Thời gian', location: 'Địa điểm', media: 'Media',
};