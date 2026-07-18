import React from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

type DialogRequest =
  | { kind: 'alert'; title: string; message: string; confirmText: string; resolve: () => void }
  | { kind: 'confirm'; title: string; message: string; confirmText: string; cancelText: string; danger: boolean; resolve: (value: boolean) => void }
  | { kind: 'prompt'; title: string; message: string; confirmText: string; cancelText: string; defaultValue: string; placeholder?: string; resolve: (value: string | null) => void };

interface DialogApi {
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, options?: { title?: string; confirmText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (message: string, options?: { title?: string; confirmText?: string; cancelText?: string; defaultValue?: string; placeholder?: string }) => Promise<string | null>;
}

type ConfirmOptions = { title?: string; confirmText?: string; cancelText?: string; danger?: boolean };
type PromptOptions = { title?: string; confirmText?: string; cancelText?: string; defaultValue?: string; placeholder?: string };

const DialogContext = React.createContext<DialogApi | null>(null);

export function EmailBuilderDialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const api = React.useMemo<DialogApi>(() => ({
    alert: (message: string, title = 'Thông báo') => new Promise<void>(resolve => {
      setRequest({ kind: 'alert', title, message, confirmText: 'Đã hiểu', resolve });
    }),
    confirm: (message: string, options: ConfirmOptions = {}) => new Promise<boolean>(resolve => {
      setRequest({
        kind: 'confirm',
        title: options.title || 'Xác nhận thao tác',
        message,
        confirmText: options.confirmText || 'Xác nhận',
        cancelText: options.cancelText || 'Hủy',
        danger: options.danger ?? false,
        resolve,
      });
    }),
    prompt: (message: string, options: PromptOptions = {}) => new Promise<string | null>(resolve => {
      setPromptValue(options.defaultValue || '');
      setRequest({
        kind: 'prompt',
        title: options.title || 'Nhập thông tin',
        message,
        confirmText: options.confirmText || 'Xác nhận',
        cancelText: options.cancelText || 'Hủy',
        defaultValue: options.defaultValue || '',
        placeholder: options.placeholder,
        resolve,
      });
    }),
  }), []);

  const settle = React.useCallback((confirmed: boolean) => {
    if (!request) return;
    if (request.kind === 'alert') request.resolve();
    else if (request.kind === 'confirm') request.resolve(confirmed);
    else request.resolve(confirmed ? promptValue.trim() : null);
    setRequest(null);
  }, [promptValue, request]);

  React.useEffect(() => {
    if (request?.kind === 'prompt') requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [request]);

  React.useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); settle(false); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, settle]);

  return <DialogContext.Provider value={api}>
    {children}
    {request && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) settle(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="ft-email-dialog-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${request.kind === 'confirm' && request.danger ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-700'}`}>
            {request.kind === 'confirm' && request.danger ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="ft-email-dialog-title" className="text-sm font-black text-slate-900">{request.title}</h2>
            <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{request.message}</p>
          </div>
          <button type="button" onClick={() => settle(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Đóng"><X className="h-4 w-4" /></button>
        </div>
        {request.kind === 'prompt' && <form onSubmit={event => { event.preventDefault(); settle(true); }} className="px-5 pt-4">
          <input ref={inputRef} value={promptValue} onChange={event => setPromptValue(event.target.value)} placeholder={request.placeholder} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </form>}
        <div className="flex justify-end gap-2 px-5 py-4">
          {request.kind !== 'alert' && <button type="button" onClick={() => settle(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">{request.cancelText}</button>}
          <button type="button" onClick={() => settle(true)} className={`rounded-xl px-4 py-2 text-xs font-bold text-white ${request.kind === 'confirm' && request.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{request.confirmText}</button>
        </div>
      </div>
    </div>}
  </DialogContext.Provider>;
}

export function useEmailBuilderDialog() {
  const value = React.useContext(DialogContext);
  if (!value) throw new Error('useEmailBuilderDialog must be used inside EmailBuilderDialogProvider');
  return value;
}
