import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Mail, PenLine } from 'lucide-react';
import { createEmailBlock } from '../../data/emailBlockRegistry';
import { copyEmailToClipboard } from '../../lib/emailClipboard';
import { generateEmailHtml } from '../../lib/emailHtmlGenerator';
import { EmailTemplate } from '../../types/emailBuilder';

interface SignatureBuilderProps {
  onBackToWorkspace: () => void;
  onOpenEmailBuilder: () => void;
}

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const labelClass = 'block text-[10px] font-extrabold uppercase tracking-wide text-slate-500';
const socialFields: Array<[string, string]> = [['Facebook', 'facebook'], ['LinkedIn', 'linkedIn'], ['YouTube', 'youtube'], ['Instagram', 'instagram'], ['Kênh khác', 'other']];

export default function SignatureBuilder({ onBackToWorkspace, onOpenEmailBuilder }: SignatureBuilderProps) {
  const [content, setContent] = useState(() => createEmailBlock('signature-builder', 'signature-studio').content);
  const [copied, setCopied] = useState(false);
  const update = (key: string, value: unknown) => setContent(current => ({ ...current, [key]: value }));
  const template = useMemo<EmailTemplate>(() => ({
    id: 'signature-studio', name: 'Chữ ký email', subject: '', lastUpdated: Date.now(),
    blocks: [{ id: 'signature-studio', type: 'signature-builder', content, styles: { marginTop: 0, marginBottom: 0 }, visible: true }],
    settings: { maxWidth: 900, externalBg: '#f1f5f9', contentBg: '#ffffff', fontFamily: 'Arial, sans-serif', textColor: '#28323D', contentPadding: 24, borderRadius: 12, linkColor: '#1473D1', btnDefaultBg: '#1473D1', btnDefaultTextColor: '#ffffff' },
  }), [content]);
  const output = useMemo(() => generateEmailHtml(template, []), [template]);
  const copySignature = async () => {
    const ok = await copyEmailToClipboard(output.copyHtml, output.plainText, Number(content.width) || 650);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return <div className="min-h-screen bg-slate-100 font-sans text-slate-800">
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-7">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-3"><button type="button" onClick={onBackToWorkspace} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Quay lại Workspace"><ArrowLeft className="h-5 w-5" /></button><div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white"><PenLine className="h-5 w-5" /></div><div><h1 className="text-sm font-black text-slate-900">Trình tạo chữ ký</h1><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">FermatTech Workspace</p></div></div>
        <div className="flex items-center gap-2"><button type="button" onClick={onOpenEmailBuilder} className="hidden rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 sm:inline-flex sm:items-center sm:gap-1.5"><Mail className="h-3.5 w-3.5" />Mẫu Email</button><button type="button" onClick={() => void copySignature()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-black text-white hover:bg-blue-700">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Đã sao chép' : 'Sao chép chữ ký'}</button></div>
      </div>
    </header>
    <main className="mx-auto grid max-w-7xl gap-5 p-4 lg:grid-cols-[390px_minmax(0,1fr)] lg:p-7">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-5"><h2 className="text-sm font-black text-slate-900">Nội dung chữ ký</h2><p className="mt-1 text-xs leading-5 text-slate-500">Chỉnh sửa, xem trước và sao chép trực tiếp vào Gmail hoặc Outlook.</p></div>
        <div className="space-y-4">
          <div><label className={labelClass}>URL logo</label><input className={fieldClass} value={content.logoUrl || ''} onChange={event => update('logoUrl', event.target.value)} placeholder="https://..." /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>Họ và tên</label><input className={fieldClass} value={content.fullName || ''} onChange={event => update('fullName', event.target.value)} /></div><div><label className={labelClass}>Chức vụ</label><input className={fieldClass} value={content.jobTitle || ''} onChange={event => update('jobTitle', event.target.value)} /></div></div>
          <div><label className={labelClass}>Công ty</label><input className={fieldClass} value={content.company || ''} onChange={event => update('company', event.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>Điện thoại</label><input className={fieldClass} value={content.phone || ''} onChange={event => update('phone', event.target.value)} /></div><div><label className={labelClass}>Email</label><input className={fieldClass} value={content.email || ''} onChange={event => update('email', event.target.value)} /></div><div><label className={labelClass}>Website</label><input className={fieldClass} value={content.website || ''} onChange={event => update('website', event.target.value)} /></div><div><label className={labelClass}>Địa chỉ</label><input className={fieldClass} value={content.address || ''} onChange={event => update('address', event.target.value)} /></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>Rộng chữ ký</label><input type="number" min="320" max="900" className={fieldClass} value={content.width ?? 650} onChange={event => update('width', Number(event.target.value))} /></div><div><label className={labelClass}>Rộng logo</label><input type="number" min="48" max="320" className={fieldClass} value={content.logoWidth ?? 150} onChange={event => update('logoWidth', Number(event.target.value))} /></div><div><label className={labelClass}>Cỡ tên</label><input type="number" min="12" max="48" className={fieldClass} value={content.titleSize ?? 22} onChange={event => update('titleSize', Number(event.target.value))} /></div><div><label className={labelClass}>Cỡ thông tin</label><input type="number" min="9" max="24" className={fieldClass} value={content.bodySize ?? 12} onChange={event => update('bodySize', Number(event.target.value))} /></div><div><label className={labelClass}>Màu nhấn</label><input type="color" className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white p-1" value={content.accentColor || '#1473D1'} onChange={event => update('accentColor', event.target.value)} /></div><div><label className={labelClass}>Màu chữ</label><input type="color" className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white p-1" value={content.textColor || '#28323D'} onChange={event => update('textColor', event.target.value)} /></div></div>
          <div className="border-t border-slate-100 pt-4"><p className="mb-3 text-[10px] font-black uppercase tracking-wide text-slate-600">Mạng xã hội & liên kết</p><div className="space-y-2.5">{socialFields.map(([label, key]) => { const suffix = `${key.charAt(0).toUpperCase()}${key.slice(1)}`; const visibleKey = `show${suffix}`; const urlKey = `${key}Url`; return <div key={key} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2"><label className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><input type="checkbox" checked={content[visibleKey] !== false} onChange={event => update(visibleKey, event.target.checked)} />{label}</label><input className={fieldClass} value={content[urlKey] || ''} onChange={event => update(urlKey, event.target.value)} placeholder="https://..." /></div>; })}</div><div className="mt-3"><label className={labelClass}>Nhãn kênh khác</label><input className={fieldClass} value={content.otherLabel || ''} onChange={event => update('otherLabel', event.target.value)} /></div></div>
        </div>
      </section>
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-black text-slate-900">Xem trước</h2><p className="text-xs text-slate-500">Bản HTML email-safe, dùng bảng để giữ định dạng.</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-700">{content.width || 650}px</span></div><div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><iframe title="Xem trước chữ ký" sandbox="" srcDoc={output.previewHtml} className="h-[420px] w-full border-0 bg-slate-100" /></div></section>
    </main>
  </div>;
}