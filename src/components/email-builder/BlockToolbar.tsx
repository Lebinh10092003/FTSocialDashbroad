import React, { useState } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  Link, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  Tag, 
  Trash2, 
  Palette,
  Sparkles
} from 'lucide-react';

interface BlockToolbarProps {
  onInsertVariableClick: () => void;
  onAlignChange?: (align: 'left' | 'center' | 'right') => void;
  activeAlign?: 'left' | 'center' | 'right';
}

export default function BlockToolbar({
  onInsertVariableClick,
  onAlignChange,
  activeAlign = 'left'
}: BlockToolbarProps) {
  const [showColors, setShowColors] = useState(false);

  const colors = [
    { value: '#1e293b', name: 'Slate' },
    { value: '#0f3a72', name: 'Fermat Deep' },
    { value: '#1473d1', name: 'Fermat Blue' },
    { value: '#e11d48', name: 'Rose Red' },
    { value: '#16a34a', name: 'Emerald' },
    { value: '#ea580c', name: 'Orange' },
    { value: '#4f46e5', name: 'Indigo' }
  ];

  const exec = (cmd: string, value: string = '') => {
    document.execCommand(cmd, false, value);
  };

  const handleLink = () => {
    const url = prompt('Nhập địa chỉ liên kết (URL):', 'https://');
    if (url) {
      exec('createLink', url);
    }
  };

  return (
    <div className="flex items-center flex-wrap gap-1 p-2 bg-slate-50 border border-slate-200/80 rounded-2xl shadow-sm mb-3">
      {/* Basic Text Formats */}
      <button
        onClick={() => exec('bold')}
        title="In đậm (Ctrl+B)"
        className="p-2 hover:bg-slate-200/80 rounded-xl text-slate-650 cursor-pointer flex items-center justify-center"
      >
        <Bold className="w-4 h-4" />
      </button>
      <button
        onClick={() => exec('italic')}
        title="In nghiêng (Ctrl+I)"
        className="p-2 hover:bg-slate-200/80 rounded-xl text-slate-650 cursor-pointer flex items-center justify-center"
      >
        <Italic className="w-4 h-4" />
      </button>
      <button
        onClick={() => exec('underline')}
        title="Gạch chân (Ctrl+U)"
        className="p-2 hover:bg-slate-200/80 rounded-xl text-slate-650 cursor-pointer flex items-center justify-center"
      >
        <Underline className="w-4 h-4" />
      </button>

      <div className="w-[1px] h-6 bg-slate-200 mx-1"></div>

      {/* Colors */}
      <div className="relative">
        <button
          onClick={() => setShowColors(!showColors)}
          title="Màu chữ"
          className="p-2 hover:bg-slate-200/80 rounded-xl text-slate-650 cursor-pointer flex items-center justify-center gap-1.5"
        >
          <Palette className="w-4 h-4" />
        </button>

        {showColors && (
          <div className="absolute top-10 left-0 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 grid grid-cols-4 gap-1.5 min-w-[120px]">
            {colors.map(c => (
              <button
                key={c.value}
                onClick={() => {
                  exec('foreColor', c.value);
                  setShowColors(false);
                }}
                className="w-6 h-6 rounded-md cursor-pointer border border-slate-250/20"
                style={{ backgroundColor: c.value }}
                title={c.name}
              />
            ))}
            <button
              onClick={() => {
                exec('removeFormat');
                setShowColors(false);
              }}
              title="Xóa định dạng màu"
              className="col-span-4 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 py-1.5 rounded-lg text-center cursor-pointer border border-rose-200/30"
            >
              Xóa định dạng
            </button>
          </div>
        )}
      </div>

      {/* Links */}
      <button
        onClick={handleLink}
        title="Chèn liên kết"
        className="p-2 hover:bg-slate-200/80 rounded-xl text-slate-650 cursor-pointer flex items-center justify-center"
      >
        <Link className="w-4 h-4" />
      </button>

      <div className="w-[1px] h-6 bg-slate-200 mx-1"></div>

      {/* Alignment (if callbacks exist) */}
      {onAlignChange && (
        <>
          <button
            onClick={() => onAlignChange('left')}
            title="Căn trái"
            className={`p-2 rounded-xl cursor-pointer flex items-center justify-center ${activeAlign === 'left' ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-200/80 text-slate-650'}`}
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onAlignChange('center')}
            title="Căn giữa"
            className={`p-2 rounded-xl cursor-pointer flex items-center justify-center ${activeAlign === 'center' ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-200/80 text-slate-650'}`}
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            onClick={() => onAlignChange('right')}
            title="Căn phải"
            className={`p-2 rounded-xl cursor-pointer flex items-center justify-center ${activeAlign === 'right' ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-200/80 text-slate-650'}`}
          >
            <AlignRight className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-6 bg-slate-200 mx-1"></div>
        </>
      )}

      {/* Personalization Variables Insert */}
      <button
        onClick={onInsertVariableClick}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-650 text-white rounded-xl text-xs font-bold shadow-sm hover:from-blue-700 hover:to-indigo-700 transition-all cursor-pointer select-none"
      >
        <Tag className="w-3.5 h-3.5" />
        Chèn biến
      </button>
    </div>
  );
}
