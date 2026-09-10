import React, { useEffect, useState } from 'react';
import { ExternalLink, FileSpreadsheet, Loader2, Save } from 'lucide-react';

type ModuleKey = 'attendance' | 'work_schedule';

type Props = {
  idToken: string;
  month: string;
  module: ModuleKey;
  title: string;
  description?: string;
  accent?: 'emerald' | 'blue';
  onLinkChange?: (url: string) => void;
};

export default function MonthlySheetLinkEditor({ idToken, month, module, title, description, accent = 'emerald', onLinkChange }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice('');
    fetch(`/api/monthly-sheet-links?month=${encodeURIComponent(month)}`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Không thể tải liên kết trang tính.');
        return body;
      })
      .then(body => {
        if (!active) return;
        const next = String(body.links?.[module] || '');
        setUrl(next);
        onLinkChange?.(next);
      })
      .catch(error => active && setNotice(error.message || 'Không thể tải liên kết trang tính.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [idToken, module, month]);

  const save = async () => {
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch(`/api/monthly-sheet-links?month=${encodeURIComponent(month)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, module, url: url.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không thể lưu liên kết trang tính.');
      const next = String(body.links?.[module] || '');
      setUrl(next);
      onLinkChange?.(next);
      setNotice('Đã lưu liên kết dành cho tháng này.');
    } catch (error: any) {
      setNotice(error.message || 'Không thể lưu liên kết trang tính.');
    } finally {
      setSaving(false);
    }
  };

  const color = accent === 'blue' ? 'text-blue-700' : 'text-emerald-700';
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 ${color}`}><FileSpreadsheet className="h-5 w-5" /></div>
        <div>
          <p className="font-extrabold text-slate-900">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description || 'Chỉ Admin có thể xem và chỉnh sửa liên kết này.'}</p>
        </div>
      </div>
      <label className="mt-4 block text-xs font-bold text-slate-600">Liên kết tháng {month.slice(5)}/{month.slice(0, 4)}</label>
      <textarea
        value={url}
        onChange={event => setUrl(event.target.value)}
        disabled={loading || saving}
        rows={3}
        placeholder="https://docs.google.com/spreadsheets/d/..."
        className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs leading-5 outline-none focus:border-blue-400 disabled:bg-slate-50"
      />
      {notice && <p className={`mt-2 text-xs font-semibold ${notice.startsWith('Đã') ? 'text-emerald-700' : 'text-rose-700'}`}>{notice}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={loading || saving} className="ft-btn ft-btn-primary text-xs">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Đang lưu...' : 'Lưu liên kết'}
        </button>
        {url && <a href={url} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary text-xs"><ExternalLink className="h-4 w-4" />Mở trang tính</a>}
      </div>
    </section>
  );
}
