import React, { useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  Palette,
  Tag,
  Underline,
} from 'lucide-react';
import ColorField from './ColorField';

interface BlockToolbarProps {
  onInsertVariableClick: () => void;
  onAlignChange?: (align: 'left' | 'center' | 'right') => void;
  onFontSizeChange?: (size: number) => void;
  onTextColorChange?: (color: string) => void;
  activeFontSize?: number;
  activeTextColor?: string;
  activeAlign?: 'left' | 'center' | 'right';
}

export default function BlockToolbar({
  onInsertVariableClick,
  onAlignChange,
  onFontSizeChange,
  onTextColorChange,
  activeFontSize = 15,
  activeTextColor = '#1E293B',
  activeAlign = 'left',
}: BlockToolbarProps) {
  const [showColors, setShowColors] = useState(false);
  const [fontSize, setFontSize] = useState(activeFontSize);
  React.useEffect(() => setFontSize(activeFontSize), [activeFontSize]);
  const [showFontSizes, setShowFontSizes] = useState(false);
  const exec = (command: string, value = '') => document.execCommand(command, false, value);
  const keepSelection = (event: React.MouseEvent) => {
    if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement) && !(event.target instanceof HTMLOptionElement)) event.preventDefault();
  };

  const createLink = () => {
    const url = prompt('Nhập địa chỉ liên kết (URL):', 'https://');
    if (url) exec('createLink', url);
  };

  const applyTextColor = (color: string) => {
    if (onTextColorChange) onTextColorChange(color);
    else exec('foreColor', color);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2 shadow-sm" onMouseDown={keepSelection}>
      <button type="button" onClick={() => exec('bold')} title="In đậm" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><Bold className="h-4 w-4" /></button>
      <button type="button" onClick={() => exec('italic')} title="In nghiêng" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><Italic className="h-4 w-4" /></button>
      <button type="button" onClick={() => exec('underline')} title="Gạch chân" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><Underline className="h-4 w-4" /></button>
      <div className="mx-1 h-6 w-px bg-slate-200" />
      {onFontSizeChange && <div className="relative">
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => setShowFontSizes(open => !open)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600" aria-haspopup="listbox" aria-expanded={showFontSizes}>Cỡ chữ <span className="text-xs text-slate-800">{fontSize}px</span><ChevronDown className="h-3 w-3" /></button>
        {showFontSizes && <div role="listbox" className="absolute left-0 top-9 z-50 grid max-h-60 min-w-28 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {[10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40, 48].map(size => <button key={size} type="button" role="option" aria-selected={fontSize === size} onMouseDown={event => event.preventDefault()} onClick={() => { setFontSize(size); setShowFontSizes(false); onFontSizeChange(size); }} className={`rounded-lg px-2 py-1.5 text-[10px] font-bold ${fontSize === size ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'}`}>{size}px</button>)}
        </div>}
      </div>}
      <div className="relative">
        <button type="button" onClick={() => setShowColors(open => !open)} title="Màu chữ" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><Palette className="h-4 w-4" /></button>
        {showColors && <div className="absolute left-0 top-10 z-50 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl" onMouseDown={event => { if (event.target instanceof HTMLInputElement) event.stopPropagation(); }}>
          <ColorField label="Màu chữ vùng đang chọn" value={activeTextColor} onChange={applyTextColor} compact />
          <button type="button" onClick={() => { exec('removeFormat'); setShowColors(false); }} className="mt-2 w-full rounded-lg bg-rose-50 py-1.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100">Xóa định dạng vùng chọn</button>
        </div>}
      </div>
      <button type="button" onClick={createLink} title="Chèn liên kết" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><Link className="h-4 w-4" /></button>
      <button type="button" onClick={() => exec('insertUnorderedList')} title="Danh sách gạch đầu dòng" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><List className="h-4 w-4" /></button>
      <button type="button" onClick={() => exec('insertOrderedList')} title="Danh sách số" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><ListOrdered className="h-4 w-4" /></button>
      <button type="button" onClick={() => { const url = prompt('Dán URL ảnh:', 'https://'); if (url) exec('insertImage', url); }} title="Chèn ảnh từ URL" className="rounded-lg p-2 text-slate-600 hover:bg-slate-200"><ImagePlus className="h-4 w-4" /></button>
      {onAlignChange && <>
        {(['left', 'center', 'right'] as const).map(align => <button key={align} type="button" onClick={() => onAlignChange(align)} className={`rounded-lg p-2 ${activeAlign === align ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-200'}`} title={`Căn ${align === 'left' ? 'trái' : align === 'center' ? 'giữa' : 'phải'}`}>
          {align === 'left' ? <AlignLeft className="h-4 w-4" /> : align === 'center' ? <AlignCenter className="h-4 w-4" /> : <AlignRight className="h-4 w-4" />}
        </button>)}
      </>}
      <button type="button" onClick={onInsertVariableClick} className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Tag className="h-3.5 w-3.5" />Chèn biến</button>
    </div>
  );
}