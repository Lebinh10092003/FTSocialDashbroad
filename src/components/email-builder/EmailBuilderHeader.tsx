import React, { useRef, useState } from 'react';
import { 
  ArrowLeft, 
  Save, 
  Copy, 
  RotateCcw, 
  Undo2,
  Redo2,
  Download, 
  Upload, 
  Trash2, 
  Eye, 
  Check,
  Edit2
} from 'lucide-react';
import { EmailTemplate } from '../../types/emailBuilder';
import { exportTemplateToJson } from '../../lib/emailStorage';
import { useEmailBuilderDialog } from './EmailBuilderDialog';

interface EmailBuilderHeaderProps {
  template: EmailTemplate;
  templatesList: EmailTemplate[];
  onSelectTemplate: (id: string) => void;
  onRenameTemplate: (name: string) => void;
  onDuplicateTemplate: () => void;
  onDeleteTemplate: () => void;
  onRestoreDefaults: () => void;
  onImportTemplate: (imported: EmailTemplate) => void;
  onPreviewClick: () => void;
  onBackToWorkspace: () => void;
  onCopyEmail: () => void;
  onCopySubject: () => void;
  copySuccess: boolean;
  copySubjectSuccess: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function EmailBuilderHeader({
  template,
  templatesList,
  onSelectTemplate,
  onRenameTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
  onRestoreDefaults,
  onImportTemplate,
  onPreviewClick,
  onBackToWorkspace,
  onCopyEmail,
  onCopySubject,
  copySuccess,
  copySubjectSuccess,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}: EmailBuilderHeaderProps) {
  
  const dialog = useEmailBuilderDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(template.name);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed.name || !Array.isArray(parsed.blocks) || !parsed.settings) {
          void dialog.alert('File JSON không đúng định dạng Email Template!', 'Không thể nhập mẫu');
          return;
        }
        
        // standard imports
        const importedTemplate: EmailTemplate = {
          ...parsed,
          id: `imported-${Date.now()}`,
          lastUpdated: Date.now()
        };
        onImportTemplate(importedTemplate);
        void dialog.alert('Nhập mẫu email thành công!', 'Nhập mẫu hoàn tất');
      } catch (error) {
        void dialog.alert('Lỗi đọc file JSON: ' + error, 'Không thể nhập mẫu');
      }
    };
    reader.readAsText(file);
    // clear input value
    if (e.target) e.target.value = '';
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameVal.trim() && nameVal.trim() !== template.name) {
      onRenameTemplate(nameVal.trim());
    }
    setIsEditingName(false);
  };

  return (
    <header className="bg-white border-b border-slate-200/80 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 z-10 shadow-[0_1px_10px_rgba(0,0,0,0.01)] shrink-0">
      
      {/* Left section: back & active template dropdown/editor */}
      <div className="flex items-center gap-4.5 min-w-0">
        <button
          onClick={onBackToWorkspace}
          className="flex items-center justify-center p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/60 transition-all cursor-pointer hover:text-slate-800"
          title="Quay lại Workspace"
        >
          <ArrowLeft className="w-4 h-4 text-slate-550" />
        </button>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button type="button" onClick={onUndo} disabled={!canUndo} title="Hoàn tác (Ctrl+Z)" className="rounded-lg p-1.5 text-slate-600 hover:bg-white hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={onRedo} disabled={!canRedo} title="Làm lại (Ctrl+Y hoặc Ctrl+Shift+Z)" className="rounded-lg p-1.5 text-slate-600 hover:bg-white hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <form onSubmit={handleRenameSubmit} className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={nameVal}
                  onChange={e => setNameVal(e.target.value)}
                  onBlur={handleRenameSubmit}
                  className="text-sm font-extrabold text-slate-900 border-b-2 border-blue-500 outline-none px-1 py-0.5 max-w-[250px]"
                />
                <button type="submit" className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded cursor-pointer">OK</button>
              </form>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-sm font-extrabold text-slate-900 truncate leading-none">{template.name}</h1>
                <button 
                  onClick={() => {
                    setNameVal(template.name);
                    setIsEditingName(true);
                  }}
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-100 rounded text-slate-450 hover:text-slate-700 transition-all cursor-pointer"
                  title="Đổi tên mẫu"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
            <span className="text-[9px] bg-emerald-50 text-emerald-700 font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-250 uppercase tracking-wide">Tự động lưu</span>
          </div>

          {/* Quick template selector dropdown */}
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">Đang sửa:</span>
            <select
              value={template.id}
              onChange={e => onSelectTemplate(e.target.value)}
              className="font-bold text-slate-700 outline-none bg-transparent hover:text-blue-650 cursor-pointer border border-transparent hover:border-slate-200 rounded-md px-1 py-0.5"
            >
              {templatesList.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Right section: utility operations + COPY CTA */}
      <div className="flex items-center gap-2 flex-wrap sm:justify-end">
        {/* Template admin controls */}
        <button
          onClick={onDuplicateTemplate}
          title="Nhân bản mẫu này"
          className="p-2 hover:bg-slate-50 border border-slate-200/50 hover:border-slate-350/50 rounded-xl text-slate-550 transition-all cursor-pointer flex items-center justify-center bg-white shadow-sm"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => { if (!exportTemplateToJson(template)) void dialog.alert('Không thể xuất file JSON template.', 'Xuất mẫu thất bại'); }}
          title="Xuất file JSON"
          className="p-2 hover:bg-slate-50 border border-slate-200/50 hover:border-slate-350/50 rounded-xl text-slate-550 transition-all cursor-pointer flex items-center justify-center bg-white shadow-sm"
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleImportClick}
          title="Nhập file JSON"
          className="p-2 hover:bg-slate-50 border border-slate-200/50 hover:border-slate-350/50 rounded-xl text-slate-550 transition-all cursor-pointer flex items-center justify-center bg-white shadow-sm"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          onClick={async () => { if (await dialog.confirm('Bạn muốn khôi phục tất cả các mẫu mặc định ban đầu của FermatTech? Các sửa đổi hiện tại sẽ bị xóa.', { title: 'Khôi phục mẫu mặc định', confirmText: 'Khôi phục', danger: true })) onRestoreDefaults(); }}
          title="Khôi phục mẫu mặc định"
          className="p-2 hover:bg-slate-50 border border-slate-200/50 hover:border-slate-350/50 rounded-xl text-slate-550 transition-all cursor-pointer flex items-center justify-center bg-white shadow-sm"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          disabled={templatesList.length <= 1}
          onClick={async () => { if (await dialog.confirm('Bạn chắc chắn muốn xóa mẫu này?', { title: 'Xóa mẫu email', confirmText: 'Xóa mẫu', danger: true })) onDeleteTemplate(); }}
          title="Xóa mẫu này"
          className="p-2 hover:bg-rose-50 border border-slate-200/50 hover:border-rose-100 rounded-xl text-slate-500 hover:text-rose-600 transition-all cursor-pointer disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-slate-500 flex items-center justify-center bg-white shadow-sm"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-[1px] h-6 bg-slate-200 mx-1"></div>

        {/* View / Copy operations */}
        <button
          onClick={onPreviewClick}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 font-extrabold text-xs rounded-xl border border-slate-200/60 transition-all cursor-pointer active:scale-[0.98]"
        >
          <Eye className="w-3.5 h-3.5" />
          Xem trước
        </button>

        <button
          onClick={onCopySubject}
          className={`flex items-center gap-1.5 px-3.5 py-2 font-extrabold text-xs rounded-xl transition-all cursor-pointer border border-transparent active:scale-[0.98] ${
            copySubjectSuccess 
              ? 'bg-emerald-500 text-white shadow-emerald-500/20 shadow-md' 
              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
          }`}
        >
          {copySubjectSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          Copy tiêu đề
        </button>

        <button
          onClick={onCopyEmail}
          className={`flex items-center gap-1.5 px-4.5 py-2 font-extrabold text-xs rounded-xl transition-all cursor-pointer shadow-md active:scale-[0.98] border border-transparent ${
            copySuccess 
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20' 
              : 'bg-gradient-to-r from-blue-600 to-indigo-650 hover:from-blue-700 hover:to-indigo-700 text-white shadow-blue-500/25'
          }`}
        >
          {copySuccess ? <Check className="w-3.5 h-3.5 animate-pulse" /> : <Save className="w-3.5 h-3.5" />}
          Copy nội dung Email
        </button>
      </div>

    </header>
  );
}
