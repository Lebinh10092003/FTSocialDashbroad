import { EmailVariable } from '../types/emailBuilder';

export const DEFAULT_EMAIL_VARIABLES: EmailVariable[] = [
  { key: 'Danh xưng', label: 'Danh xưng (Anh/Chị/...)', defaultValue: 'Anh' },
  { key: 'Tên phụ huynh', label: 'Tên phụ huynh', defaultValue: 'Nguyễn Văn Minh' },
  { key: 'Họ tên học sinh', label: 'Họ tên học sinh', defaultValue: 'Nguyễn Minh An' },
  { key: 'Lớp', label: 'Lớp học', defaultValue: '5A1' },
  { key: 'Trường', label: 'Trường học', defaultValue: 'Tiểu học Đoàn Thị Điểm' },
  { key: 'Mã thí sinh', label: 'Mã số thí sinh', defaultValue: 'AYSBC-50123' },
  { key: 'Ngày thi', label: 'Ngày thi', defaultValue: '25/10/2026' },
  { key: 'Link đăng ký', label: 'Link đăng ký cá nhân', defaultValue: 'https://aysbc.fermat.vn/register?code=AYSBC-50123' }
];
