import React, { useEffect, useState } from 'react';
import { Code2, FileCheck2, X } from 'lucide-react';

interface Props {
  templateName: string;
  initialHtml: string;
  onClose: () => void;
  onApply: (html: string) => Promise<string | null>;
}

export default function EmailHtmlSourceDialog({ templateName, initialHtml, onClose, onApply }: Props) {
  const [html, setHtml] = useState(initialHtml);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setHtml(initialHtml);
    setError('');
  }, [initialHtml]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const source = html.trim();
    if (!source) {
      setError('Vui lòng nhập mã HTML của email.');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await onApply(source);
    setSubmitting(false);
    if (result) setError(result);
    else onClose();
  };

  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="ft-html-source-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl">
      <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Code2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="ft-html-source-title" className="text-base font-black text-slate-900">Xem và sửa HTML email</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Bạn đang sửa <strong className="text-slate-700">{templateName}</strong>. Lưu sẽ áp dụng trực tiếp cho email này, không tạo mẫu mới.</p>
        </div>
        <button type="button" onClick={onClose} disabled={submitting} aria-label="Đóng trình sửa HTML" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
        <textarea autoFocus value={html} onChange={event => setHtml(event.target.value)} spellCheck={false} className="min-h-[420px] w-full resize-y rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"><FileCheck2 className="mt-0.5 h-4 w-4 shrink-0" />Mã sẽ được kiểm tra an toàn và tách lại thành các khối chỉnh sửa được. Các biến như <code>{'{{Link xác nhận}}'}</code> được giữ nguyên trong HTML xuất ra.</div>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Hủy</button>
        <button type="submit" disabled={submitting} className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{submitting ? 'Đang kiểm tra…' : 'Lưu HTML vào email này'}</button>
      </footer>
    </form>
  </div>;
}
