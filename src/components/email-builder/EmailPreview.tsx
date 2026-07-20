import React, { useState, useEffect, useRef } from 'react';
import { X, Monitor, Smartphone, AlertTriangle } from 'lucide-react';
import { EmailTemplate, EmailVariable } from '../../types/emailBuilder';
import { generateEmailHtml } from '../../lib/emailHtmlGenerator';

interface EmailPreviewProps {
  template: EmailTemplate;
  variables: EmailVariable[];
  onClose: () => void;
}

export default function EmailPreview({
  template,
  variables,
  onClose
}: EmailPreviewProps) {
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [useMock, setUseMock] = useState(false);

  // Dùng previewHtml (WYSIWYG) thay vì html (email export)
  const { previewHtml, subject, warnings } = generateEmailHtml(template, variables, useMock);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastHeightRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  const updateIframeHeight = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow && iframe.contentDocument) {
        try {
          const doc = iframe.contentDocument;
          const height = doc.documentElement.scrollHeight || doc.body.scrollHeight;
          if (height !== lastHeightRef.current && height > 0) {
            lastHeightRef.current = height;
            iframe.style.height = `${height}px`;
          }
        } catch (e) {
          // Ignored
        }
      }
    });
  };

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let timers: NodeJS.Timeout[] = [];
    lastHeightRef.current = 0; // Reset khi nội dung thay đổi

    const triggerHeightUpdate = () => updateIframeHeight();

    const handleLoad = () => {
      triggerHeightUpdate();
      const t1 = setTimeout(triggerHeightUpdate, 100);
      const t2 = setTimeout(triggerHeightUpdate, 400);
      const t3 = setTimeout(triggerHeightUpdate, 1000);
      const t4 = setTimeout(triggerHeightUpdate, 2000);
      timers.push(t1, t2, t3, t4);
    };

    iframe.addEventListener('load', handleLoad);
    triggerHeightUpdate();
    const tStart = setTimeout(triggerHeightUpdate, 250);
    timers.push(tStart);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      timers.forEach(t => clearTimeout(t));
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [previewHtml, viewMode]);

  // Màu nền ngoài để container preview khớp với iframe
  const externalBg = template.settings?.externalBg || '#f1f5f9';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-7xl bg-slate-100 rounded-3xl border border-slate-200 shadow-2xl flex flex-col h-[90vh] overflow-hidden animate-fade-in">

        {/* Header Toolbar */}
        <div className="p-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-extrabold text-slate-900">Xem trước Email</h2>
            <div className="flex bg-slate-100 border border-slate-200 p-0.5 rounded-xl">
              <button
                onClick={() => setViewMode('desktop')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${viewMode === 'desktop' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Máy tính (Desktop)
              </button>
              <button
                onClick={() => setViewMode('mobile')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${viewMode === 'mobile' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Điện thoại (Mobile)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {/* Toggle Mock Data */}
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 font-bold select-none bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hover:bg-slate-100/70 transition-all">
              <input
                type="checkbox"
                checked={useMock}
                onChange={e => setUseMock(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
              />
              Điền dữ liệu mẫu (Mock data)
            </label>

            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Warnings Pane */}
        {warnings.length > 0 && (
          <div className="bg-amber-50 border-b border-amber-200/60 p-3.5 px-6 shrink-0 max-h-[120px] overflow-y-auto">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4.5 h-4.5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-amber-900 leading-tight">Cảnh báo chất lượng hiển thị ({warnings.length})</h4>
                <ul className="list-disc pl-4 mt-1 space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-[10px] text-amber-700 font-semibold">{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Subject preview bar */}
        <div
          className="shrink-0 border-b px-5 py-2 flex items-center gap-2 text-xs select-none"
          style={{ background: externalBg }}
        >
          <span className="font-bold text-slate-700 shrink-0">Tiêu đề:</span>
          <span className="truncate text-slate-900 font-semibold">{subject || '[Trống]'}</span>
        </div>

        {/* Email preview frame - màu nền ngoài khớp với externalBg */}
        <div
          className="flex flex-1 overflow-auto"
          style={{ background: externalBg }}
        >
          {/* Desktop: căn giữa email trong khung, Mobile: giới hạn 390px căn giữa */}
          <div
            className="mx-auto w-full shrink-0 flex flex-col transition-all duration-300"
            style={{
              maxWidth: viewMode === 'mobile' ? '390px' : `${template.settings?.maxWidth || 680}px`,
              width: viewMode === 'mobile' ? '390px' : '100%',
            }}
          >
            {/* Iframe không có thanh cuộn, tự giãn chiều cao theo nội dung */}
            <iframe
              ref={iframeRef}
              key={`${viewMode}-${previewHtml.length}`}
              title="Email Preview Frame"
              srcDoc={previewHtml}
              width="100%"
              scrolling="no"
              className="w-full border-0 block min-h-[400px]"
              style={{ background: externalBg }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
