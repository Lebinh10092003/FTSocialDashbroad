import React, { useEffect } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
};

export default function ExamDialog({ open, title, description, children, onClose, onSubmit, submitLabel = 'Lưu thay đổi', busy }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <form onSubmit={async event => { event.preventDefault(); await onSubmit?.(); }} className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <button type="button" onClick={onClose} className="float-right rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng"><X className="h-5 w-5" /></button>
      <h2 className="pr-8 text-2xl font-extrabold text-[#101827]">{title}</h2>
      {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
      <div className="mt-5">{children}</div>
      <div className="mt-6 flex justify-end gap-3 border-t pt-5">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Hủy</button>
        {onSubmit && <button disabled={busy} className="ft-primary disabled:opacity-50" type="submit">{busy ? 'Đang lưu…' : submitLabel}</button>}
      </div>
    </form>
  </div>;
}