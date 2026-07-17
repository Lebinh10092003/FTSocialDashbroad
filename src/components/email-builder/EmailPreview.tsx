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

  // Compile layout
  const { html, subject, warnings } = generateEmailHtml(template, variables, useMock);

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

    let observer: ResizeObserver | null = null;

    const setupObserver = () => {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc && doc.body) {
        if (observer) {
          observer.disconnect();
        }
        observer = new ResizeObserver(() => {
          updateIframeHeight();
        });
        observer.observe(doc.body);
        updateIframeHeight();
      }
    };

    iframe.addEventListener('load', setupObserver);
    setupObserver();

    return () => {
      iframe.removeEventListener('load', setupObserver);
      if (observer) {
        observer.disconnect();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [html]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-5xl bg-slate-100 rounded-3xl border border-slate-200 shadow-2xl flex flex-col h-[90vh] overflow-hidden animate-fade-in">
        
        {/* Header Toolbar */}
        <div className="p-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-extrabold text-slate-900">Xem trước Email</h2>
            <div className="flex bg-slate-100 border border-slate-200 p-0.5 rounded-xl">
              <button
                onClick={() => setViewMode('desktop')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${viewMode === 'desktop' ? 'bg-white text-blue-650 shadow-sm' : 'text-slate-500'}`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Máy tính (Desktop)
              </button>
              <button
                onClick={() => setViewMode('mobile')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${viewMode === 'mobile' ? 'bg-white text-blue-650 shadow-sm' : 'text-slate-500'}`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Điện thoại (Mobile)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {/* Toggle Mock Data */}
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-750 font-bold select-none bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hover:bg-slate-100/70 transition-all">
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

        {/* Dynamic Frame container */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-200/40 flex justify-center items-start">
          <div
            className="transition-all duration-300 bg-white border border-slate-200 w-full flex flex-col shrink-0"
            style={{
              width: viewMode === 'mobile' ? '375px' : '100%',
              maxWidth: viewMode === 'mobile' ? '375px' : `${template.settings.maxWidth}px`
            }}
          >
            {/* Subject preview */}
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 text-xs text-slate-500 font-medium select-none flex gap-2 shrink-0">
              <span className="font-bold text-slate-750">Tiêu đề:</span>
              <span className="truncate text-slate-900 font-semibold">{subject || '[Trống]'}</span>
            </div>

            {/* Iframe container with no scrollbar */}
            <div className="w-full bg-white relative">
              <iframe
                ref={iframeRef}
                title="Email Preview Frame"
                srcDoc={html}
                scrolling="no"
                className="w-full border-0 block min-h-[300px]"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
