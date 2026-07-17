import React from 'react';
import { EmailSettings } from '../../types/emailBuilder';

interface EmailSettingsComponentProps {
  settings: EmailSettings;
  onUpdateSettings: (settings: EmailSettings) => void;
}

export default function EmailSettingsComponent({
  settings,
  onUpdateSettings
}: EmailSettingsComponentProps) {

  // Premium corporate colors swatch list
  const swatches = [
    { value: '#0f3a72', name: 'Fermat Deep' },
    { value: '#1473d1', name: 'Fermat Blue' },
    { value: '#16a34a', name: 'Emerald' },
    { value: '#ea580c', name: 'Orange' },
    { value: '#e11d48', name: 'Rose Red' },
    { value: '#f8fafc', name: 'Soft Slate' },
    { value: '#1e293b', name: 'Dark Slate' },
    { value: '#ffffff', name: 'White' }
  ];

  const updateSetting = (key: keyof EmailSettings, value: any) => {
    onUpdateSettings({
      ...settings,
      [key]: value
    });
  };

  const fonts = [
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
    { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' }
  ];

  const ColorSwatchPicker = ({ label, value, onChange }: { label: string, value: string, onChange: (color: string) => void }) => (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold text-slate-500">{label}</label>
      <div className="flex gap-2">
        <input
          type="color"
          value={value || '#ffffff'}
          onChange={e => onChange(e.target.value)}
          className="w-9 h-9 rounded-xl cursor-pointer border border-slate-200 p-0.5 bg-white shrink-0 shadow-sm"
        />
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="w-full text-xs rounded-xl border border-slate-200 px-3 outline-none focus:border-blue-500 shadow-sm bg-white"
        />
      </div>
      <div className="grid grid-cols-8 gap-1.5 pt-0.5">
        {swatches.map(s => (
          <button
            key={s.value}
            type="button"
            onClick={() => onChange(s.value)}
            title={s.name}
            className={`w-6 h-6 rounded-lg cursor-pointer border transition-all ${value === s.value ? 'ring-2 ring-blue-550 border-white scale-105' : 'border-slate-250/30 hover:scale-105'}`}
            style={{ backgroundColor: s.value }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 p-5 bg-white overflow-y-auto h-full select-text">
      <div>
        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Email chung</h3>
        <p className="text-[10px] text-slate-450 mt-1">Cấu hình thông số kích thước, font chữ chủ đạo và bảng màu cho khung email.</p>
      </div>

      <div className="space-y-4">
        {/* Layout Dimensions */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Chiều rộng tối đa (px)</label>
            <input
              type="number"
              min="300"
              max="1200"
              value={settings.maxWidth || 650}
              onChange={e => updateSetting('maxWidth', parseInt(e.target.value) || 650)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Bo góc viền khung (px)</label>
            <input
              type="number"
              min="0"
              max="50"
              value={settings.borderRadius ?? 16}
              onChange={e => updateSetting('borderRadius', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
        </div>

        {/* Spacings & Typography */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Mép đệm dọc (px)</label>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.contentPadding ?? 24}
              onChange={e => updateSetting('contentPadding', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Font chữ chủ đạo</label>
            <select
              value={settings.fontFamily || 'Arial, Helvetica, sans-serif'}
              onChange={e => updateSetting('fontFamily', e.target.value)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white shadow-sm"
            >
              {fonts.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Brand System Colors */}
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Hệ màu khung nền</h4>
          
          <ColorSwatchPicker
            label="Màu nền ngoài (External Background)"
            value={settings.externalBg || '#f8fafc'}
            onChange={color => updateSetting('externalBg', color)}
          />

          <ColorSwatchPicker
            label="Màu nền nội dung (Content Background)"
            value={settings.contentBg || '#ffffff'}
            onChange={color => updateSetting('contentBg', color)}
          />
        </div>

        {/* Fonts & Links colors */}
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Màu chữ & Liên kết</h4>

          <div className="grid grid-cols-2 gap-3">
            <ColorSwatchPicker
              label="Màu chữ chính"
              value={settings.textColor || '#1e293b'}
              onChange={color => updateSetting('textColor', color)}
            />
            <ColorSwatchPicker
              label="Màu liên kết (Link)"
              value={settings.linkColor || '#1473d1'}
              onChange={color => updateSetting('linkColor', color)}
            />
          </div>
        </div>

        {/* Button defaults */}
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-wider">Màu nút bấm mặc định</h4>

          <div className="grid grid-cols-2 gap-3">
            <ColorSwatchPicker
              label="Nền nút mặc định"
              value={settings.btnDefaultBg || '#1473d1'}
              onChange={color => updateSetting('btnDefaultBg', color)}
            />
            <ColorSwatchPicker
              label="Chữ nút mặc định"
              value={settings.btnDefaultTextColor || '#ffffff'}
              onChange={color => updateSetting('btnDefaultTextColor', color)}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
