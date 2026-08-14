import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type DialogTone = 'info' | 'success' | 'warning' | 'danger';
type CommonOptions = {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
};
type PromptOptions = CommonOptions & {
  defaultValue?: string;
  placeholder?: string;
  inputType?: React.HTMLInputTypeAttribute;
};
type DialogRequest =
  | (CommonOptions & { kind: 'alert'; message: string; resolve: () => void })
  | (CommonOptions & { kind: 'confirm'; message: string; resolve: (value: boolean) => void })
  | (PromptOptions & { kind: 'prompt'; message: string; resolve: (value: string | null) => void });

type Subscriber = (request: DialogRequest) => void;
const subscribers = new Set<Subscriber>();
const waiting: DialogRequest[] = [];

function publish(request: DialogRequest) {
  const subscriber = subscribers.values().next().value as Subscriber | undefined;
  if (subscriber) subscriber(request);
  else waiting.push(request);
}

export const appDialog = {
  alert(message: string, options: CommonOptions = {}) {
    return new Promise<void>(resolve => publish({ kind: 'alert', message, ...options, resolve }));
  },
  confirm(message: string, options: CommonOptions = {}) {
    return new Promise<boolean>(resolve => publish({ kind: 'confirm', message, ...options, resolve }));
  },
  prompt(message: string, options: PromptOptions = {}) {
    return new Promise<string | null>(resolve => publish({ kind: 'prompt', message, ...options, resolve }));
  },
};

const toneClasses: Record<DialogTone, { icon: string; button: string }> = {
  info: { icon: 'bg-blue-50 text-blue-700', button: 'ft-btn ft-btn-primary' },
  success: { icon: 'bg-emerald-50 text-emerald-700', button: 'ft-btn bg-emerald-600 text-white hover:bg-emerald-700' },
  warning: { icon: 'bg-amber-50 text-amber-700', button: 'ft-btn bg-amber-600 text-white hover:bg-amber-700' },
  danger: { icon: 'bg-rose-50 text-rose-700', button: 'ft-btn ft-btn-danger bg-rose-600 text-white hover:bg-rose-700' },
};

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [promptValue, setPromptValue] = useState('');
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const request = queue[0] || null;

  useEffect(() => {
    const subscriber: Subscriber = item => setQueue(current => [...current, item]);
    subscribers.add(subscriber);
    if (waiting.length) setQueue(current => [...current, ...waiting.splice(0)]);
    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    if (!request) return;
    if (request.kind === 'alert') request.resolve();
    else if (request.kind === 'confirm') request.resolve(confirmed);
    else request.resolve(confirmed ? promptValue.trim() : null);
    setQueue(current => current.slice(1));
  }, [promptValue, request]);

  useEffect(() => {
    if (!request) return;
    const focusedBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (request.kind === 'prompt') setPromptValue(request.defaultValue || '');
    requestAnimationFrame(() => {
      if (request.kind === 'prompt') {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        panelRef.current?.querySelector<HTMLElement>('[data-dialog-primary]')?.focus();
      }
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      focusedBeforeOpen?.focus();
    };
  }, [request, settle]);

  const tone = request?.tone || (request?.kind === 'confirm' ? 'warning' : 'info');
  const colors = toneClasses[tone];
  const title = request?.title || (request?.kind === 'confirm' ? 'Xác nhận thao tác' : request?.kind === 'prompt' ? 'Nhập thông tin' : 'Thông báo');
  const confirmText = request?.confirmText || (request?.kind === 'alert' ? 'Đã hiểu' : 'Xác nhận');

  return (
    <>
      {children}
      {request && (
        <div
          lang={'vi'}
          translate={'no'}
          className={'notranslate fixed inset-0 z-[12000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm'}
          onMouseDown={event => {
            if (event.target === event.currentTarget) settle(false);
          }}
        >
          <div
            ref={panelRef}
            role={'dialog'}
            aria-modal={'true'}
            aria-labelledby={titleId}
            className={'max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/60 bg-white shadow-2xl'}
          >
            <header className={'flex items-start gap-3 border-b border-slate-100 px-5 py-4'}>
              <div className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${colors.icon}`}>
                {tone === 'danger' || tone === 'warning' ? <AlertTriangle className={'h-5 w-5'} /> : tone === 'success' ? <CheckCircle2 className={'h-5 w-5'} /> : <Info className={'h-5 w-5'} />}
              </div>
              <div className={'min-w-0 flex-1'}>
                <h2 id={titleId} className={'text-base font-extrabold text-slate-900'}>{title}</h2>
                <p className={'mt-1 whitespace-pre-line text-sm leading-6 text-slate-600'}>{request.message}</p>
              </div>
              <button type={'button'} onClick={() => settle(false)} className={'rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700'} aria-label={'Đóng hộp thoại'}>
                <X className={'h-4 w-4'} />
              </button>
            </header>
            {request.kind === 'prompt' && (
              <form onSubmit={event => { event.preventDefault(); settle(true); }} className={'px-5 pt-4'}>
                <input
                  ref={inputRef}
                  value={promptValue}
                  onChange={event => setPromptValue(event.target.value)}
                  placeholder={request.placeholder}
                  type={request.inputType || 'text'}
                  className={'ft-input'}
                />
              </form>
            )}
            <footer className={'flex flex-wrap justify-end gap-2 px-5 py-4'}>
              {request.kind !== 'alert' && (
                <button type={'button'} onClick={() => settle(false)} className={'ft-btn ft-btn-secondary'}>
                  {request.cancelText || 'Hủy'}
                </button>
              )}
              <button type={'button'} data-dialog-primary onClick={() => settle(true)} className={colors.button}>
                {confirmText}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
