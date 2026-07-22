import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  GraduationCap,
  Handshake,
  LogIn,
  Plus,
  Users,
} from 'lucide-react';

type Tab = 'calendar' | 'sessions' | 'partners' | 'survey' | 'materials';

const categories = [
  'Triển khai BNDC',
  'Ứng dụng AI trong quản lý hành chính',
  'Ứng dụng AI trong giảng dạy',
  'Đào tạo lớp học số',
];

const sessions = [
  { date: '2026-07-08', title: 'Tập huấn triển khai BNDC', partner: 'THCS Cầu Giấy', category: categories[0], attendees: 42 },
  { date: '2026-07-15', title: 'AI cho giáo viên', partner: 'THCS Lê Quý Đôn', category: categories[2], attendees: 36 },
  { date: '2026-07-22', title: 'Quản lý hành chính cùng AI', partner: 'Phòng GD&ĐT Ba Đình', category: categories[1], attendees: 28 },
  { date: '2026-07-29', title: 'Xây dựng lớp học số', partner: 'Tiểu học Đoàn Thị Điểm', category: categories[3], attendees: 54 },
];

const tabs = [
  { id: 'calendar' as Tab, label: 'Lịch tập huấn', icon: CalendarDays },
  { id: 'sessions' as Tab, label: 'Danh sách buổi', icon: ClipboardList },
  { id: 'partners' as Tab, label: 'Đối tác', icon: Handshake },
  { id: 'survey' as Tab, label: 'Khảo sát', icon: Users },
  { id: 'materials' as Tab, label: 'Tài liệu', icon: BookOpen },
];

export default function DigitalTraining({ onBackToWorkspace, onAccountClick, isGuest, userName }: { onBackToWorkspace: () => void; onAccountClick: () => void; isGuest: boolean; userName?: string | null }) {
  const [tab, setTab] = useState<Tab>('calendar');
  const byDay = useMemo(() => Object.fromEntries(sessions.map(item => [Number(item.date.slice(-2)), item])), []);
  const days = Array.from({ length: 31 }, (_, index) => index + 1);
  const activeLabel = tabs.find(item => item.id === tab)?.label || '';

  return <div className="flex min-h-screen bg-slate-50 text-slate-800">
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white lg:flex">
      <div className="flex items-center gap-3 border-b border-slate-100 p-5">
        <img src="/logo.png" alt="FermatTech" className="h-8 object-contain" />
        <div className="border-l border-slate-200 pl-3"><p className="text-sm font-extrabold text-slate-900">Fermat</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cyan-600">{'Đào tạo số'}</p></div>
      </div>
      <div className="p-4">
        <button onClick={onBackToWorkspace} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />{'Quay lại Workspace'}</button>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-2">{tabs.map(item => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} onClick={() => setTab(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs font-bold transition ${active ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
      <div className="border-t border-slate-100 p-4">
        <button onClick={onAccountClick} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-cyan-700">{isGuest && <LogIn className="h-4 w-4" />}{isGuest ? 'Đăng nhập' : userName || 'Tài khoản'}</button>
      </div>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="flex min-h-16 items-center justify-between border-b border-slate-200/70 bg-white px-5 md:px-8">
        <div className="flex items-center gap-3"><button onClick={onBackToWorkspace} className="lg:hidden"><ArrowLeft className="h-5 w-5" /></button><div><p className="text-xs font-bold uppercase tracking-wide text-cyan-600">{'Đào tạo số'}</p><h1 className="text-lg font-extrabold text-slate-900">{activeLabel}</h1></div></div>
        <button onClick={onAccountClick} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 lg:hidden">{isGuest ? 'Đăng nhập' : userName || 'Tài khoản'}</button>
      </header>
      <div className="mx-auto max-w-[1600px] p-5 md:p-7">
        <section className="rounded-2xl bg-gradient-to-r from-cyan-700 to-blue-700 p-6 text-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-white/15"><GraduationCap className="h-6 w-6" /></div><h2 className="text-2xl font-extrabold">{'Quản lý tập huấn và chuyển đổi số'}</h2><p className="mt-2 max-w-2xl text-sm text-cyan-50">{'Theo dõi lịch, đối tác, khảo sát và tài liệu theo từng chương trình.'}</p></div><button className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-cyan-700"><Plus className="h-4 w-4" />{'Tạo buổi tập huấn'}</button></div></section>
        {tab === 'calendar' && <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5"><h2 className="text-xl font-extrabold">{'Lịch tập huấn · Tháng 7/2026'}</h2><p className="mt-1 text-sm text-slate-500">{'Xem trực quan các buổi đào tạo theo lịch.'}</p></div><div className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200 bg-slate-200">{['T2','T3','T4','T5','T6','T7','CN'].map(day => <div key={day} className="bg-slate-50 p-3 text-center text-xs font-bold text-slate-500">{day}</div>)}<div className="min-h-24 bg-white" />{days.map(day => { const item = byDay[day]; return <div key={day} className="min-h-24 bg-white p-2"><b className="text-xs text-slate-500">{day}</b>{item && <div className="mt-2 rounded-lg bg-cyan-50 p-2 text-xs text-cyan-900"><b className="line-clamp-2 block">{item.title}</b><span className="mt-1 block text-cyan-700">{item.partner}</span></div>}</div>; })}</div></section>}
        {tab === 'sessions' && <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="p-5"><h2 className="text-xl font-extrabold">{'Danh sách buổi tập huấn'}</h2></div><div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>{'Thời gian'}</th><th>{'Buổi tập huấn'}</th><th>{'Đối tác'}</th><th>{'Lĩnh vực'}</th><th>{'Tham gia'}</th></tr></thead><tbody>{sessions.map(item => <tr key={item.date}><td>{new Date(`${item.date}T00:00:00`).toLocaleDateString('vi-VN')}</td><td><b>{item.title}</b></td><td>{item.partner}</td><td>{item.category}</td><td>{item.attendees}</td></tr>)}</tbody></table></div></section>}
        {tab === 'partners' && <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[...new Set(sessions.map(item => item.partner))].map((partner, index) => <article key={partner} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Handshake className="h-7 w-7 text-cyan-600" /><h2 className="mt-4 font-extrabold">{partner}</h2><p className="mt-2 text-3xl font-extrabold text-slate-900">{index + 1}</p><p className="text-sm text-slate-500">{'buổi đã tập huấn'}</p></article>)}</section>}
        {tab === 'survey' && <section className="mt-6 grid gap-5 lg:grid-cols-2"><article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><FileText className="h-7 w-7 text-cyan-600" /><h2 className="mt-4 text-xl font-extrabold">{'Khảo sát sau tập huấn'}</h2><p className="mt-2 text-sm text-slate-500">{'Thu thập phản hồi để cải thiện nội dung đào tạo.'}</p><button className="mt-5 ft-primary">{'Tạo form khảo sát'}</button></article><article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-extrabold">{'Kết quả đánh giá'}</h2>{[['Hài lòng chung','4.7/5'],['Có thể áp dụng','92%'],['Sẵn sàng giới thiệu','95%']].map(([label, value]) => <div key={label} className="mt-4 flex justify-between rounded-lg bg-slate-50 p-4"><span>{label}</span><b className="text-cyan-700">{value}</b></div>)}</article></section>}
        {tab === 'materials' && <section className="mt-6 grid gap-4 md:grid-cols-2">{categories.map((item, index) => <article key={item} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><BookOpen className="h-7 w-7 text-cyan-600" /><h2 className="mt-4 font-extrabold">{item}</h2><p className="mt-2 text-sm text-slate-500">{`${index + 2} tài liệu · slide, hướng dẫn và biểu mẫu.`}</p><button className="mt-5 text-sm font-bold text-cyan-700">{'Mở kho tài liệu →'}</button></article>)}</section>}
      </div>
    </main>
  </div>;
}
