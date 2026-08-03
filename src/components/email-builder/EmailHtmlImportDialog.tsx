import React, { useMemo, useState } from 'react';
import { Code2, FileCheck2, X } from 'lucide-react';
import { HtmlImportMode } from '../../lib/emailTemplateFactory';

interface EmailHtmlImportDialogProps {
  onClose: () => void;
  onImport: (templateName: string, html: string, mode: HtmlImportMode) => Promise<string | null>;
}

const defaultTemplateName = () => `Mẫu HTML ${new Date().toLocaleString('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})}`;

export default function EmailHtmlImportDialog({ onClose, onImport }: EmailHtmlImportDialogProps) {
  const [templateName, setTemplateName] = useState(defaultTemplateName);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<HtmlImportMode>('editable');

  const detectedSubject = useMemo(() => {
    if (!html.trim() || typeof DOMParser === 'undefined') return '';
    return new DOMParser().parseFromString(html, 'text/html').querySelector('title')?.textContent?.trim() || '';
  }, [html]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = templateName.trim();
    const source = html.trim();
    if (!name) {
      setError('Vui lòng nhập tên dùng để quản lý mẫu email.');
      return;
    }
    if (!source) {
      setError('Vui lòng dán mã HTML của email.');
      return;
    }
    setSubmitting(true);
    setError('');
    const importError = await onImport(name, source, mode);
    setSubmitting(false);
    if (importError) setError(importError);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="ft-html-import-title" className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Code2 className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 id="ft-html-import-title" className="text-base font-black text-slate-900">Dán mã HTML để tạo mẫu email</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Tên mẫu chỉ dùng để quản lý nội bộ. Nội dung trong thẻ &lt;title&gt; sẽ trở thành tiêu đề email và vẫn có thể sửa sau khi nhập.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Đóng trình nhập HTML" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-700">Tên mẫu email <span className="text-rose-500">*</span></span>
            <input value={templateName} onChange={event => setTemplateName(event.target.value)} maxLength={160} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>

          <fieldset>
            <legend className="mb-1.5 text-xs font-bold text-slate-700">Cách chuyển đổi</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`cursor-pointer rounded-xl border p-3 transition ${mode === 'editable' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="html-import-mode" value="editable" checked={mode === 'editable'} onChange={() => setMode('editable')} className="sr-only" />
                <span className="block text-xs font-black text-slate-800">Tách thành các khối chỉnh sửa được</span>
                <span className="mt-1 block text-[11px] leading-4 text-slate-500">Khuyến nghị — tự nhận diện tiêu đề, đoạn văn, ảnh, nút, danh sách, bảng và bố cục.</span>
              </label>
              <label className={`cursor-pointer rounded-xl border p-3 transition ${mode === 'preserve' ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="html-import-mode" value="preserve" checked={mode === 'preserve'} onChange={() => setMode('preserve')} className="sr-only" />
                <span className="block text-xs font-black text-slate-800">Giữ nguyên HTML trong một khối</span>
                <span className="mt-1 block text-[11px] leading-4 text-slate-500">Dùng khi cần ưu tiên giao diện giống tuyệt đối và không cần sửa từng phần.</span>
              </label>
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-700"><span>Mã HTML <span className="text-rose-500">*</span></span><span className="font-medium text-slate-400">Có thể dán toàn bộ tài liệu hoặc phần nội dung email</span></span>
            <textarea autoFocus value={html} onChange={event => setHtml(event.target.value)} spellCheck={false} placeholder={'<!DOCTYPE html>\n<html>\n  <head><title>Tiêu đề gửi khách hàng</title></head>\n  <body>...</body>\n</html>'} className="min-h-[320px] w-full resize-y rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Tiêu đề phát hiện</p>
              <p className="mt-1 truncate text-xs font-bold text-slate-700">{detectedSubject || 'Chưa có thẻ <title> — tiêu đề email sẽ để trống'}</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800"><FileCheck2 className="h-4 w-4 shrink-0" />Script, iframe và liên kết nguy hiểm sẽ được loại bỏ tự động.</div>
          </div>

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Hủy</button>
          <button type="submit" disabled={submitting} className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{submitting ? 'Đang kiểm tra…' : 'Tạo mẫu từ HTML'}</button>
        </footer>
      </form>
    </div>
  );
}
