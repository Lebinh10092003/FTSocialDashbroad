import React, { useEffect, useState } from 'react';
import type { DraftDate, ExaminationSession } from './types';

/** Local calendar date, avoiding UTC shifts in countdown labels. */
export const todayIso = (value = new Date()) => {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
};
export const emptyDate = (): DraftDate => ({ day: '', month: '', year: '', planned: false, unknown: false });
export function dateValue(value: DraftDate) {
  if (value.unknown) return { label: 'Chưa có thông tin' };
  const raw = value.day ? `${value.day}/${value.month}/${value.year}` : `Tháng ${value.month}/${value.year}`;
  return { label: value.planned ? `Dự kiến ${raw}` : raw, date: value.day ? `${value.year}-${value.month.padStart(2, '0')}-${value.day.padStart(2, '0')}` : undefined };
}
export function DateBadge({ label, date }: { label: string; date?: string }) {
  if (!date) return <span className="text-xs font-semibold text-slate-500">{label}</span>;
// Refresh just after local midnight, even when the module stays open overnight.
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const refresh = () => setToday(todayIso());
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 2, 0);
    const timer = window.setTimeout(refresh, nextMidnight.getTime() - now.getTime());
    return () => window.clearTimeout(timer);
  }, [today]);
  const days = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  const style = days < 0 ? 'border-blue-200 bg-blue-50 text-blue-700' : days <= 7 ? 'border-red-600 bg-red-600 text-white' : days <= 15 ? 'border-red-300 bg-white text-red-600' : days <= 31 ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-bold ${style}`}>{label} · {days < 0 ? 'Đã qua' : days === 0 ? 'Hôm nay' : `Còn ${days} ngày`}</span>;
}
export function Metric({ label, value, icon: Icon, onClick }: { label: string; value: string; icon: React.ElementType; onClick?: () => void }) {
  const body = <><div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span><Icon className="h-5 w-5 text-[#001e40]" /></div><p className="mt-4 text-4xl font-extrabold text-[#001e40]">{value}</p></>;
  return onClick ? <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-[#001e40] hover:shadow-sm">{body}</button> : <div className="rounded-xl border border-slate-200 bg-white p-5">{body}</div>;
}
export function DeadlineLegend() { return <div className="flex flex-wrap gap-2 text-[10px] font-semibold"><span className="text-blue-700">Đã qua</span><span className="text-emerald-700">›1 tháng</span><span className="text-orange-700">≤1 tháng</span><span className="text-red-600">≤15 ngày</span><span className="rounded bg-red-600 px-1 text-white">≤7 ngày</span></div>; }
export function TimeField({ label, value, onChange }: { label: string; value: DraftDate; onChange: (value: DraftDate) => void }) {
  const update = (key: keyof DraftDate, next: string | boolean) => onChange({ ...value, [key]: next });
  return <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-bold">{label}</legend><div className="mb-3 flex gap-4 text-xs font-semibold"><label><input type="checkbox" checked={value.planned} disabled={value.unknown} onChange={event => update('planned', event.target.checked)} /> Thời gian dự kiến</label><label><input type="checkbox" checked={value.unknown} onChange={event => onChange({ ...value, unknown: event.target.checked, planned: event.target.checked ? false : value.planned })} /> Chưa có thông tin</label></div>{value.unknown ? <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-500">Chưa có thông tin về thời gian.</p> : <><div className="grid grid-cols-3 gap-2">{(['day', 'month', 'year'] as const).map((part, index) => <select key={part} value={value[part]} onChange={event => update(part, event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"><option value="">{index === 0 ? 'Ngày' : index === 1 ? 'Tháng' : 'Năm'}{index === 0 && value.planned ? ' (tuỳ chọn)' : ''}</option>{Array.from({ length: index === 0 ? 31 : index === 1 ? 12 : 4 }, (_, itemIndex) => { const option = index === 2 ? 2026 + itemIndex : itemIndex + 1; return <option key={option} value={String(option)}>{option}</option>; })}</select>)}</div><p className="mt-2 text-[11px] text-slate-500">{value.planned ? 'Dự kiến: bắt buộc tháng và năm; ngày có thể để trống.' : 'Chính thức: bắt buộc đủ ngày, tháng và năm.'}</p></>}</fieldset>;
}
export function sessionDisplayName(session: ExaminationSession) {
  const monthYear = (date?: string, fallback?: string) => { if (date) { const [year, month] = date.split('-'); return `T${Number(month)}/${year}`; } const match = fallback?.match(/T?(\d{1,2})\/(\d{4})/i); return match ? `T${Number(match[1])}/${match[2]}` : (fallback || 'Chưa có thông tin'); };
  return `${session.code}: ${monthYear(session.nationalDate, session.national)} - ${monthYear(session.internationalDate, session.international)}`;
}
export function SessionsTable({ items, onSelect }: { items: ExaminationSession[]; onSelect: (session: ExaminationSession) => void }) {
  const rounds = (session: ExaminationSession) => [{ id: 'national', name: 'Vòng quốc gia', label: session.national, date: session.nationalDate }, { id: 'international', name: 'Vòng quốc tế', label: session.international, date: session.internationalDate }, ...(session.rounds || [])].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return <div className="overflow-x-auto"><table className="ft-table min-w-[1180px]"><thead><tr><th>Kỳ tổ chức</th><th>Cuộc thi mẹ</th><th>BTC quốc tế</th><th>Thời gian</th><th>Số thí sinh</th><th>Các vòng thi</th><th>Giai đoạn hiện tại</th><th>Ghi chú</th></tr></thead><tbody>{items.map(session => <tr key={session.id} onClick={() => onSelect(session)} className="cursor-pointer hover:bg-blue-50/50"><td><b className="text-[#001e40]">{sessionDisplayName(session)}</b><p className="mt-1 max-w-52 text-xs text-slate-500">{session.name}</p></td><td>{session.parent}</td><td>{session.organizer}</td><td>{session.time}</td><td className="text-center font-bold">{session.candidates.toLocaleString('vi-VN')}</td><td><div className="flex min-w-48 flex-col gap-1.5">{rounds(session).map(round => <div key={round.id}><p className="mb-0.5 text-[10px] font-bold text-slate-500">{round.name}</p><DateBadge label={round.label} date={round.date} /></div>)}</div></td><td><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold">{session.phase}</span></td><td className="max-w-60 text-sm text-slate-600">{session.note}</td></tr>)}</tbody></table></div>;
}