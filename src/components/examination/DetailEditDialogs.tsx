import React from 'react';
import type { Candidate, Competition, ExaminationSession, SessionRound } from './types';
import ExamDialog from './ExamDialog';
import { sessionRounds } from './rounds';
import { BirthDateControl, TimeField, dateValue, emptyDate, formatPersonName } from './ui';

type Teacher = { name: string; subject: string; phone: string; email: string; workplace: string };
type Mode = 'competition' | 'session' | 'candidate' | 'teacher' | 'enrol' | null;
type Props = { mode: Mode; error: string; busy: boolean; competitions: Competition[]; competition: Competition; session: ExaminationSession; candidate: Candidate; teacher: Teacher; onClose: () => void; onCompetitionChange: (value: Competition) => void; onSessionChange: (value: ExaminationSession) => void; onCandidateChange: (value: Candidate) => void; onTeacherChange: (value: Teacher) => void; onSave: () => void | Promise<void>; };
const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2';
const SESSION_PHASE_SUGGESTIONS = [
  'Chuẩn bị/Truyền thông',
  'Tuyển sinh',
  'Vòng quốc gia',
  'Ôn tập Vòng quốc tế',
  'Vòng quốc tế',
  'Công bố kết quả',
  'Hoàn thành',
];
const CandidateFields = ({ value, onChange, enrollment = false }: { value: Candidate; onChange: (value: Candidate) => void; enrollment?: boolean }) => {
  const fields: [keyof Candidate, string][] = [['name', 'Họ và tên *'], ['identity', 'Căn cước công dân'], ['email', 'Email'], ['school', 'Tên trường'], ['className', 'Lớp đang học'], ['grade', 'Khối lớp hiện tại'], ['city', 'Tỉnh / thành phố cư trú'], ['ward', 'Xã / phường'], ['nationality', 'Quốc tịch'], ['achievement', 'Kết quả / giải thưởng'], ['highestRound', 'Vòng cao nhất đã đạt'], ['parent', 'Phụ huynh'], ['phone', 'Điện thoại'], ['address', 'Địa chỉ'], ...(enrollment ? ([['code', 'Mã FT (để trống để tự tạo)']] as [keyof Candidate, string][]) : [])];
  return <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold">Ngày sinh</span><BirthDateControl value={value.birthDate} onChange={birthDate => onChange({ ...value, birthDate })}/></label>{fields.map(([field, label]) => <label key={field} className={field === 'address' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input type="text" value={String(value[field] || '')} onChange={event => onChange({ ...value, [field]: field === 'name' || field === 'parent' ? formatPersonName(event.target.value) : event.target.value })} className={input}/></label>)}{!enrollment && <label className="sm:col-span-2"><span className="text-sm font-bold">Các cuộc thi đã tham gia</span><input value={value.contests} onChange={event => onChange({ ...value, contests: event.target.value })} className={input} placeholder="AYSBC, IMO"/></label>}</div>;
};
function draftDateFrom(date?: string, label?: string) {
  const text = String(label || '').trim();
  const unknown = text.toLocaleLowerCase('vi-VN').includes('ch\u01b0a c\u00f3 th\u00f4ng tin');
  const planned = text.toLocaleLowerCase('vi-VN').startsWith('d\u1ef1 ki\u1ebfn');
  const iso = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return { day: String(Number(iso[3])), month: String(Number(iso[2])), year: iso[1], planned, unknown: false };
  const monthYear = text.match(/(\d{1,2})\/(\d{4})/);
  if (monthYear) return { day: '', month: String(Number(monthYear[1])), year: monthYear[2], planned, unknown: false };
  return { ...emptyDate(), planned, unknown };
}

function SessionFields({ value, competitions, onChange }: { value: ExaminationSession; competitions: Competition[]; onChange: (next: ExaminationSession) => void }) {
  const configuredRounds = Array.isArray(value.rounds) ? value.rounds.filter(round => String(round.name || '').trim()) : [];
  const rounds = configuredRounds.length ? configuredRounds : sessionRounds(value);
  const updateRound = (index: number, patch: Partial<SessionRound>) => onChange({ ...value, rounds: rounds.map((round, current) => current === index ? { ...round, ...patch } : round) });
  const updateRoundTime = (index: number, time: ReturnType<typeof emptyDate>) => {
    const timing = dateValue(time);
    updateRound(index, { label: timing.label || '', date: timing.date || '' });
  };
  return <div className="grid gap-4">
    <label><span className="text-sm font-bold">Tên kỳ tổ chức *</span><input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} className={input}/></label>
    <label><span className="text-sm font-bold">Cuộc thi *</span><select value={value.competitionId || ''} onChange={event => onChange({ ...value, competitionId: event.target.value })} className={input}>{competitions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold">Giai đoạn hiện tại</span><input list="session-phase-suggestions" value={value.phase || ''} onChange={event => onChange({ ...value, phase: event.target.value })} placeholder="Chọn hoặc nhập giai đoạn khác" className={input}/><datalist id="session-phase-suggestions">{SESSION_PHASE_SUGGESTIONS.map(phase => <option key={phase} value={phase}/>)}</datalist><small className="mt-1 block text-xs text-slate-500">Có thể chọn gợi ý hoặc nhập giai đoạn mới.</small></label><label><span className="text-sm font-bold">Ghi chú chung</span><input value={value.note || ''} onChange={event => onChange({ ...value, note: event.target.value })} className={input}/></label></div>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3"><h3 className="font-extrabold text-[#001e40]">Các vòng thi</h3><p className="mt-1 text-sm text-slate-500">Tên vòng tạo ra tab tương ứng trên trang chi tiết. Mỗi vòng dùng cùng cách khai báo thời gian như lúc tạo kỳ.</p></div><div className="grid gap-3">{rounds.map((round, index) => <div key={round.id || index} className="rounded-lg border bg-white p-3"><div className="flex items-center justify-between gap-3"><b className="text-sm text-[#001e40]">Vòng {index + 1}</b><button type="button" onClick={() => { if (window.confirm(`Xóa ${round.name || `Vòng ${index + 1}`} khỏi kỳ tổ chức? Dữ liệu lịch, ca thi và tab của vòng này sẽ bị bỏ khi lưu thay đổi.`)) onChange({ ...value, rounds: rounds.filter((_, current) => current !== index) }); }} className="text-xs font-bold text-rose-600">Xóa vòng</button></div><label className="mt-3 block"><span className="text-xs font-bold text-slate-500">Tên vòng thi *</span><input value={round.name || ''} onChange={event => updateRound(index, { name: event.target.value })} className={input}/></label><div className="mt-3"><TimeField label={`Thời gian ${round.name || `Vòng ${index + 1}`}`} value={draftDateFrom(round.date, round.label)} onChange={time => updateRoundTime(index, time)}/></div></div>)}</div><button type="button" onClick={() => onChange({ ...value, rounds: [...rounds, { id: `round-${Date.now()}`, name: '', label: '', date: '' }] })} className="mt-3 rounded-lg border border-dashed border-[#aa3000] px-3 py-2 text-sm font-bold text-[#aa3000]">+ Thêm vòng thi</button></div>
  </div>;
}
export default function DetailEditDialogs(props: Props) {
  const { mode, error, busy, competitions, competition, session, candidate, teacher, onClose, onCompetitionChange, onSessionChange, onCandidateChange, onTeacherChange, onSave } = props;
  if (!mode) return null;
  const body = mode === 'competition' ? <div className="grid gap-4 sm:grid-cols-2">{([['code', 'Mã cuộc thi'], ['name', 'Tên cuộc thi'], ['organizer', 'Ban tổ chức quốc tế'], ['parent', 'Cuộc thi mẹ']] as [keyof Competition, string][]).map(([field, label]) => <label key={field} className={field === 'name' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input value={competition[field]} onChange={event => onCompetitionChange({ ...competition, [field]: event.target.value })} className={input}/></label>)}</div> : mode === 'session' ? <SessionFields value={session} competitions={competitions} onChange={onSessionChange}/> : mode === 'teacher' ? <div className="grid gap-4 sm:grid-cols-2">{([['name', 'Họ và tên'], ['subject', 'Chuyên môn'], ['phone', 'Điện thoại'], ['email', 'Email'], ['workplace', 'Đơn vị công tác']] as [keyof Teacher, string][]).map(([field, label]) => <label key={field} className={field === 'workplace' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input value={teacher[field]} onChange={event => onTeacherChange({ ...teacher, [field]: event.target.value })} className={input}/></label>)}</div> : <CandidateFields value={candidate} onChange={onCandidateChange} enrollment={mode === 'enrol'}/>;
  const title = mode === 'competition' ? 'Thay đổi thông tin cuộc thi' : mode === 'session' ? 'Thay đổi thông tin kỳ tổ chức' : mode === 'teacher' ? 'Thay đổi thông tin giáo viên' : mode === 'enrol' ? 'Thêm thí sinh vào kỳ thi' : 'Thay đổi hồ sơ thí sinh';
  const description = mode === 'session' ? 'Cập nhật cùng một cấu trúc với lúc tạo kỳ: tên kỳ, cuộc thi, các vòng và mốc ngày. Vòng chưa có thông tin có thể để trống ngày.' : mode === 'enrol' ? 'Hồ sơ trùng khớp cả họ tên, ngày sinh, CCCD và email sẽ được cập nhật vào thí sinh có sẵn; nếu không hệ thống tạo mã FT mới.' : 'Các thay đổi được cập nhật ngay vào dữ liệu chung và những luồng liên quan.';
  return <ExamDialog open title={title} description={description} onClose={onClose} onSubmit={onSave} busy={busy} submitLabel={mode === 'enrol' ? 'Thêm và đồng bộ' : 'Lưu thay đổi'}>{body}{error && <p className="mt-4 text-sm font-semibold text-rose-600">{error}</p>}</ExamDialog>;
}