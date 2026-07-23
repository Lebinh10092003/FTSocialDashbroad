import React, { useEffect, useState } from 'react';
import type { DraftDate, ExaminationSession } from './types';
import { sessionRounds } from './rounds';

/** Local calendar date, avoiding UTC shifts in countdown labels. */
export const todayIso = (value = new Date()) => {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
};
export const emptyDate = (): DraftDate => ({ day: '', month: '', year: '', planned: false, unknown: false });
export function normaliseBirthDate(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}$/.test(raw)) return raw;
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const parts = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  let year = '', month = '', day = '';
  if (iso) [, year, month, day] = iso;
  else if (parts) {
    const [, first, second, last] = parts;
    year = last.length === 2 ? `20${last}` : last;
    if (Number(first) > 12) [day, month] = [first, second];
    else if (Number(second) > 12) [month, day] = [first, second];
    else [day, month] = [first, second];
  } else return raw;
  const candidate = new Date(Number(year), Number(month) - 1, Number(day));
  if (!Number.isInteger(Number(year)) || candidate.getFullYear() !== Number(year) || candidate.getMonth() !== Number(month) - 1 || candidate.getDate() !== Number(day)) return raw;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
export function formatGrade(value?: string) { return String(value || '').trim().replace(/^khối\s*/i, ''); }
export function formatBirthDate(value?: string) {
  const normalized = normaliseBirthDate(value);
  if (/^\d{4}$/.test(normalized)) return normalized;
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (normalized || '—');
}
export function dateValue(value: DraftDate) {
  if (value.unknown) return { label: 'Ch\u01b0a c\u00f3 th\u00f4ng tin', date: '' };
  const hasMonthYear = Boolean(value.month && value.year);
  const hasFullDate = Boolean(value.day && hasMonthYear);
  if (!hasMonthYear) return { label: value.planned ? 'D\u1ef1 ki\u1ebfn' : '', date: '' };
  const raw = hasFullDate ? `${value.day}/${value.month}/${value.year}` : `Th\u00e1ng ${value.month}/${value.year}`;
  return { label: value.planned ? `D\u1ef1 ki\u1ebfn ${raw}` : raw, date: hasFullDate ? `${value.year}-${value.month.padStart(2, '0')}-${value.day.padStart(2, '0')}` : '' };
}
export function DateBadge({ label, date }: { label: string; date?: string }) {
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
  const normalizedDate = String(date || '').trim();
  const labelText = String(label || '').trim() || 'Ch\u01b0a c\u00f3 th\u00f4ng tin';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return <span className="text-xs font-semibold text-slate-500">{labelText}</span>;
  const target = new Date(`${normalizedDate}T00:00:00`).getTime();
  const days = Math.round((target - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  if (!Number.isFinite(days)) return <span className="text-xs font-semibold text-slate-500">{labelText}</span>;
  const style = days < 0 ? 'border-blue-200 bg-blue-50 text-blue-700' : days <= 7 ? 'border-red-600 bg-red-600 text-white' : days <= 15 ? 'border-red-300 bg-white text-red-600' : days <= 31 ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return <span className={`inline-flex whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-bold ${style}`}>{labelText} · {days < 0 ? '\u0110\u00e3 qua' : days === 0 ? 'H\u00f4m nay' : `C\u00f2n ${days} ng\u00e0y`}</span>;
}export function Metric({ label, value, icon: Icon, onClick }: { label: string; value: string; icon: React.ElementType; onClick?: () => void }) {
  const body = <><div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span><Icon className="h-5 w-5 text-[#001e40]" /></div><p className="mt-4 text-4xl font-extrabold text-[#001e40]">{value}</p></>;
  return onClick ? <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-[#001e40] hover:shadow-sm">{body}</button> : <div className="rounded-xl border border-slate-200 bg-white p-5">{body}</div>;
}
export function DeadlineLegend() { return <div className="flex flex-wrap gap-2 text-[10px] font-semibold"><span className="text-blue-700">Đã qua</span><span className="text-emerald-700">›1 tháng</span><span className="text-orange-700">≤1 tháng</span><span className="text-red-600">≤15 ngày</span><span className="rounded bg-red-600 px-1 text-white">≤7 ngày</span></div>; }
export function TimeField({ label, value, onChange }: { label: string; value: DraftDate; onChange: (value: DraftDate) => void }) {
  const update = (key: keyof DraftDate, next: string | boolean) => onChange({ ...value, [key]: next });
  const setUnknown = (unknown: boolean) => onChange({ ...value, unknown, planned: unknown ? false : value.planned });
  const plannedText = 'Th\u1eddi gian d\u1ef1 ki\u1ebfn';
  const unknownText = 'Ch\u01b0a c\u00f3 th\u00f4ng tin';
  return <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-bold">{label}</legend><div className="mb-3 flex gap-4 text-xs font-semibold"><label className="inline-flex cursor-pointer items-center gap-1"><input className="cursor-pointer" type="checkbox" checked={Boolean(value.planned)} disabled={Boolean(value.unknown)} onChange={event => update('planned', event.currentTarget.checked)} /><span>{plannedText}</span></label><label className="inline-flex cursor-pointer items-center gap-1"><input className="cursor-pointer" type="checkbox" checked={Boolean(value.unknown)} onChange={event => setUnknown(event.currentTarget.checked)} /><span>{unknownText}</span></label></div>{value.unknown ? <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-500">{'Ch\u01b0a c\u00f3 th\u00f4ng tin v\u1ec1 th\u1eddi gian.'}</p> : <><div className="grid grid-cols-3 gap-2">{(['day', 'month', 'year'] as const).map((part, index) => <select key={part} value={value[part] || ''} onChange={event => update(part, event.currentTarget.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"><option value="">{index === 0 ? 'Ng\u00e0y' : index === 1 ? 'Th\u00e1ng' : 'N\u0103m'}{index === 0 && value.planned ? ' (tu\u1ef3 ch\u1ecdn)' : ''}</option>{Array.from({ length: index === 0 ? 31 : index === 1 ? 12 : 31 }, (_, itemIndex) => { const option = index === 2 ? new Date().getFullYear() - 10 + itemIndex : itemIndex + 1; return <option key={option} value={String(option)}>{option}</option>; })}</select>)}</div><p className="mt-2 text-[11px] text-slate-500">{value.planned ? 'D\u1ef1 ki\u1ebfn: b\u1eaft bu\u1ed9c th\u00e1ng v\u00e0 n\u0103m; ng\u00e0y c\u00f3 th\u1ec3 \u0111\u1ec3 tr\u1ed1ng.' : 'Ch\u00ednh th\u1ee9c: b\u1eaft bu\u1ed9c \u0111\u1ee7 ng\u00e0y, th\u00e1ng v\u00e0 n\u0103m.'}</p></>}</fieldset>;
}export function sessionDisplayName(session: ExaminationSession) {
  const monthYear = (date?: string, fallback?: string) => {
    const iso = String(date || '').trim().match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
    if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `T${Number(iso[2])}/${iso[1]}`;
    const text = String(fallback || '').trim();
    const match = text.match(/T?(\d{1,2})\/(\d{4})/i);
    return match ? `T${Number(match[1])}/${match[2]}` : (/^(none|null|nan)$/i.test(text) ? 'Chưa có thông tin' : (text || 'Chưa có thông tin'));
  };
  return `${session.code}: ${monthYear(session.nationalDate, session.national)} - ${monthYear(session.internationalDate, session.international)}`;
}
export function SessionsTable({ items, onSelect }: { items: ExaminationSession[]; onSelect: (session: ExaminationSession) => void }) {
  const rounds = (session: ExaminationSession) => sessionRounds(session).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return <div className="overflow-x-auto"><table className="ft-table min-w-[1180px]"><thead><tr><th>Kỳ tổ chức</th><th>Cuộc thi mẹ</th><th>BTC quốc tế</th><th>Thời gian</th><th>Số thí sinh</th><th>Các vòng thi</th><th>Giai đoạn hiện tại</th><th>Ghi chú</th></tr></thead><tbody>{items.map(session => <tr key={session.id} onClick={() => onSelect(session)} className="cursor-pointer hover:bg-blue-50/50"><td><b className="text-[#001e40]">{sessionDisplayName(session)}</b><p className="mt-1 max-w-52 text-xs text-slate-500">{session.name}</p></td><td>{session.parent}</td><td>{session.organizer}</td><td>{session.time}</td><td className="text-center font-bold">{session.candidates.toLocaleString('vi-VN')}</td><td><div className="flex min-w-48 flex-col gap-1.5">{rounds(session).map(round => <div key={round.id}><p className="mb-0.5 text-[10px] font-bold text-slate-500">{round.name}</p><DateBadge label={round.label} date={round.date} /></div>)}</div></td><td><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold">{session.phase}</span></td><td className="max-w-60 text-sm text-slate-600">{session.note}</td></tr>)}</tbody></table></div>;
}