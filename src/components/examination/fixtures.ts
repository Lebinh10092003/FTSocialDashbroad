import { CalendarDays, GraduationCap, LayoutDashboard, Trophy, UploadCloud, Users } from 'lucide-react';
import type { Candidate, Competition, ExaminationPage, ExaminationSession } from './types';

export const initialSessions: ExaminationSession[] = [
  { id: 'aysbc', code: 'AYSBC', name: 'Huy hiệu các Nhà khoa học trẻ Châu Á', parent: 'AYSBC', organizer: 'SCS và META Knowledge', time: 'T7/2026', candidates: 1284, national: '26/7/2026', nationalDate: '2026-07-26', international: 'Dự kiến T10/2026', phase: 'Tuyển sinh', note: 'Thí sinh hoàn thành tích lũy sao đến hết ngày 28/7.' },
  { id: 'imo', code: 'IMO', name: 'International Maths Olympiad', parent: 'IMO', organizer: 'SCO', time: 'T6–T8/2026', candidates: 862, national: '21/6/2026', nationalDate: '2026-06-21', international: '9/8/2026', internationalDate: '2026-08-09', phase: 'Ôn tập vòng Quốc tế', note: 'Đang tổ chức lớp ôn tập.' },
  { id: 'ieo', code: 'IEO', name: 'International English Olympiad', parent: 'IEO - English', organizer: 'SCO', time: 'T6–T8/2026', candidates: 735, national: '21/6/2026', nationalDate: '2026-06-21', international: '9/8/2026', internationalDate: '2026-08-09', phase: 'Ôn tập vòng Quốc tế', note: 'Đang tổ chức lớp ôn tập.' },
  { id: 'iso', code: 'ISO', name: 'International Science Olympiad', parent: 'ISO - Science', organizer: 'SCO', time: 'T6–T8/2026', candidates: 691, national: '21/6/2026', nationalDate: '2026-06-21', international: '9/8/2026', internationalDate: '2026-08-09', phase: 'Ôn tập vòng Quốc tế', note: 'Đang tổ chức lớp ôn tập.' },
  { id: 'fimo', code: 'FIMO', name: 'FermatTech International Mathematics Olympiad', parent: 'FIMO', organizer: 'FermatTech', time: 'Dự kiến T9/2026', candidates: 320, national: 'Dự kiến tháng 9', international: 'Không tổ chức năm đầu', phase: 'Chuẩn bị hồ sơ', note: 'Hoàn thiện điều lệ và đối tác địa phương.' },
  { id: 'fieo', code: 'FIEO', name: 'FermatTech International English Olympiad', parent: 'FIEO - Tiếng Anh', organizer: 'FermatTech', time: 'Dự kiến T9/2026', candidates: 286, national: 'Dự kiến tháng 9', international: 'Không tổ chức năm đầu', phase: 'Chuẩn bị hồ sơ', note: 'Hoàn thiện điều lệ và đối tác địa phương.' },
];
export const initialCandidates: Candidate[] = [
  { code: 'FT26-0001', name: 'Nguyễn Minh Anh', school: 'THCS Cầu Giấy', className: '8A1', city: 'Hà Nội', contests: 'AYSBC, IMO', achievement: 'HCV — AYSBC 2025', updated: '18/07/2026 09:20', email: 'minhanh@example.com', parent: 'Nguyễn Thu Hà', phone: '0988 123 456', identity: '001212345678', address: 'Cầu Giấy, Hà Nội', birthDate: '2012-05-17' },
  { code: 'FT26-0042', name: 'Trần Gia Bảo', school: 'THCS Lê Quý Đôn', className: '9A3', city: 'Đà Nẵng', contests: 'IMO, ISO', achievement: 'HCB — IMO 2025', updated: '17/07/2026 16:45', email: 'giabao@example.com', parent: 'Trần Văn Long', phone: '0912 456 789', identity: '048211234567', address: 'Hải Châu, Đà Nẵng', birthDate: '2011-10-02' },
  { code: 'FT26-0079', name: 'Lê Hoàng Nam', school: 'Tiểu học Đoàn Thị Điểm', className: '7A2', city: 'Hà Nội', contests: 'AYSBC, IEO', achievement: 'Top 10 — IEO 2025', updated: '16/07/2026 11:05', email: 'hoangnam@example.com', parent: 'Lê Thị Mai', phone: '0903 555 222', identity: '001213456789', address: 'Nam Từ Liêm, Hà Nội', birthDate: '2013-01-25' },
];
export const initialCompetitions = (): Competition[] => initialSessions.map(({ id, code, name, organizer, parent }) => ({ id, code, name, organizer, parent }));
export const navigationItems: { id: Exclude<ExaminationPage, 'competition-detail' | 'candidate-detail'>; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'competitions', label: 'Cuộc thi', icon: Trophy },
  { id: 'sessions', label: 'Kỳ tổ chức', icon: CalendarDays },
  { id: 'candidates', label: 'Thí sinh', icon: Users },
  { id: 'classes', label: 'Lớp ôn tập', icon: GraduationCap },
  { id: 'import', label: 'Nhập dữ liệu', icon: UploadCloud },
];