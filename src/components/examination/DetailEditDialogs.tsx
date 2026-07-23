import React from 'react';
import type { Candidate, Competition, ExaminationSession } from './types';
import ExamDialog from './ExamDialog';

type Teacher = { name: string; subject: string; phone: string; email: string; workplace: string };
type Mode = 'competition' | 'session' | 'candidate' | 'teacher' | 'enrol' | null;
type Props = {
  mode: Mode;
  error: string;
  busy: boolean;
  competitions: Competition[];
  competition: Competition;
  session: ExaminationSession;
  candidate: Candidate;
  teacher: Teacher;
  onClose: () => void;
  onCompetitionChange: (value: Competition) => void;
  onSessionChange: (value: ExaminationSession) => void;
  onCandidateChange: (value: Candidate) => void;
  onTeacherChange: (value: Teacher) => void;
  onSave: () => void | Promise<void>;
};
const input = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
const CandidateFields = ({ value, onChange, enrollment = false }: { value: Candidate; onChange: (value: Candidate) => void; enrollment?: boolean }) => <div className="grid gap-4 sm:grid-cols-2">
  {([['name', 'Họ và tên *'], ['birthDate', 'Ngày sinh'], ['identity', 'Căn cước công dân'], ['email', 'Email'], ['school', 'Tên trường'], ['className', 'Lớp đang học'], ['grade', 'Khối lớp hiện tại'], ['city', 'Tỉnh / thành phố cư trú'], ['ward', 'Xã / phường'], ['nationality', 'Quốc tịch'], ['achievement', 'Kết quả / giải thưởng'], ['highestRound', 'Vòng cao nhất đã đạt'], ['parent', 'Phụ huynh'], ['phone', 'Điện thoại'], ['address', 'Địa chỉ'], ...(enrollment ? [['code', 'Mã FT (để trống để tự tạo)']] : [])] as [keyof Candidate, string][]).map(([field, label]) => <label key={field} className={field === 'address' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input type={field === 'birthDate' ? 'date' : 'text'} value={String(value[field] || '')} onChange={event => onChange({ ...value, [field]: event.target.value })} className={input} /></label>)}
  {!enrollment && <label className="sm:col-span-2"><span className="text-sm font-bold">Các cuộc thi đã tham gia</span><input value={value.contests} onChange={event => onChange({ ...value, contests: event.target.value })} className={input} placeholder="AYSBC, IMO" /></label>}
</div>;
export default function DetailEditDialogs(props: Props) {
  const { mode, error, busy, competitions, competition, session, candidate, teacher, onClose, onCompetitionChange, onSessionChange, onCandidateChange, onTeacherChange, onSave } = props;
  if (!mode) return null;
  const body = mode === 'competition' ? <div className="grid gap-4 sm:grid-cols-2">
    {([['code', 'Mã cuộc thi'], ['name', 'Tên cuộc thi'], ['organizer', 'Ban tổ chức quốc tế'], ['parent', 'Cuộc thi mẹ']] as [keyof Competition, string][]).map(([field, label]) => <label key={field} className={field === 'name' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input value={competition[field]} onChange={event => onCompetitionChange({ ...competition, [field]: event.target.value })} className={input} /></label>)}
  </div> : mode === 'session' ? <div className="grid gap-4 sm:grid-cols-2">
    <label className="sm:col-span-2"><span className="text-sm font-bold">Tên kỳ tổ chức</span><input value={session.name} onChange={event => onSessionChange({ ...session, name: event.target.value })} className={input} /></label>
    <label><span className="text-sm font-bold">Cuộc thi</span><select value={session.competitionId || ''} onChange={event => onSessionChange({ ...session, competitionId: event.target.value })} className={input}>{competitions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
    <label><span className="text-sm font-bold">Giai đoạn hiện tại</span><input value={session.phase} onChange={event => onSessionChange({ ...session, phase: event.target.value })} className={input} /></label>
    <label><span className="text-sm font-bold">Ngày vòng quốc gia</span><input type="date" value={session.nationalDate || ''} onChange={event => onSessionChange({ ...session, nationalDate: event.target.value, national: event.target.value ? new Date(`${event.target.value}T00:00:00`).toLocaleDateString('vi-VN') : session.national })} className={input} /></label>
    <label><span className="text-sm font-bold">Ngày vòng quốc tế</span><input type="date" value={session.internationalDate || ''} onChange={event => onSessionChange({ ...session, internationalDate: event.target.value, international: event.target.value ? new Date(`${event.target.value}T00:00:00`).toLocaleDateString('vi-VN') : session.international })} className={input} /></label>
    <label className="sm:col-span-2"><span className="text-sm font-bold">Ghi chú</span><textarea value={session.note} onChange={event => onSessionChange({ ...session, note: event.target.value })} className={`${input} min-h-24`} /></label>
  </div> : mode === 'teacher' ? <div className="grid gap-4 sm:grid-cols-2">
    {([['name', 'Họ và tên'], ['subject', 'Chuyên môn'], ['phone', 'Điện thoại'], ['email', 'Email'], ['workplace', 'Đơn vị công tác']] as [keyof Teacher, string][]).map(([field, label]) => <label key={field} className={field === 'workplace' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input value={teacher[field]} onChange={event => onTeacherChange({ ...teacher, [field]: event.target.value })} className={input} /></label>)}
  </div> : <CandidateFields value={candidate} onChange={onCandidateChange} enrollment={mode === 'enrol'} />;
  const title = mode === 'competition' ? 'Thay đổi thông tin cuộc thi' : mode === 'session' ? 'Thay đổi thông tin kỳ tổ chức' : mode === 'teacher' ? 'Thay đổi thông tin giáo viên' : mode === 'enrol' ? 'Thêm thí sinh vào kỳ thi' : 'Thay đổi hồ sơ thí sinh';
  const description = mode === 'enrol' ? 'Hồ sơ trùng khớp cả họ tên, ngày sinh, CCCD và email sẽ được cập nhật vào thí sinh có sẵn; nếu không hệ thống tạo mã FT mới.' : 'Các thay đổi được cập nhật ngay vào dữ liệu chung và những luồng liên quan.';
  return <ExamDialog open title={title} description={description} onClose={onClose} onSubmit={onSave} busy={busy} submitLabel={mode === 'enrol' ? 'Thêm và đồng bộ' : 'Lưu thay đổi'}>{body}{error && <p className="mt-4 text-sm font-semibold text-rose-600">{error}</p>}</ExamDialog>;
}