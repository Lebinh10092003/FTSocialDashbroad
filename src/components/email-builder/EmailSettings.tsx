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

  return (
    <div className="space-y-5 p-4.5 bg-white overflow-y-auto h-full">
      <div>
        <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Cấu hình Email chung</h3>
        <p className="text-[10px] text-slate-500 mt-1">Điều chỉnh các thông số hiển thị và màu sắc của toàn bộ khung thư.</p>
      </div>

      <div className="space-y-4">
        {/* Dimensions */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Chiều rộng email (px)</label>
            <input
              type="number"
              min="300"
              max="1200"
              value={settings.maxWidth || 650}
              onChange={e => updateSetting('maxWidth', parseInt(e.target.value) || 650)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Bo góc khung email (px)</label>
            <input
              type="number"
              min="0"
              max="50"
              value={settings.borderRadius ?? 16}
              onChange={e => updateSetting('borderRadius', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Spacing & Font */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Đệm nội dung (px)</label>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.contentPadding ?? 24}
              onChange={e => updateSetting('contentPadding', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Font chữ chủ đạo</label>
            <select
              value={settings.fontFamily || 'Arial, Helvetica, sans-serif'}
              onChange={e => updateSetting('fontFamily', e.target.value)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white"
            >
              {fonts.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <h4 className="text-[10px] font-extrabold text-slate-700 uppercase mb-2.5">Bảng màu hệ thống</h4>

          <div className="space-y-3">
            {/* Background Colors */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu nền bên ngoài (External bg)</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={settings.externalBg || '#f8fafc'}
                  onChange={e => updateSetting('externalBg', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={settings.externalBg || '#f8fafc'}
                  onChange={e => updateSetting('externalBg', e.target.value)}
                  className="flex-1 text-xs rounded-xl border border-slate-200 px-2.5 py-1.5 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu nền nội dung (Content bg)</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={settings.contentBg || '#ffffff'}
                  onChange={e => updateSetting('contentBg', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={settings.contentBg || '#ffffff'}
                  onChange={e => updateSetting('contentBg', e.target.value)}
                  className="flex-1 text-xs rounded-xl border border-slate-200 px-2.5 py-1.5 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Colors for Text & Link */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu chữ mặc định</label>
                <div className="flex gap-1">
                  <input
                    type="color"
                    value={settings.textColor || '#1e293b'}
                    onChange={e => updateSetting('textColor', e.target.value)}
                    className="w-7 h-7 rounded-md cursor-pointer border border-slate-200 p-0.5 bg-white"
                  />
                  <input
                    type="text"
                    value={settings.textColor || '#1e293b'}
                    onChange={e => updateSetting('textColor', e.target.value)}
                    className="flex-1 text-[11px] rounded-lg border border-slate-200 px-1.5 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu liên kết mặc định</label>
                <div className="flex gap-1">
                  <input
                    type="color"
                    value={settings.linkColor || '#1473d1'}
                    onChange={e => updateSetting('linkColor', e.target.value)}
                    className="w-7 h-7 rounded-md cursor-pointer border border-slate-200 p-0.5 bg-white"
                  />
                  <input
                    type="text"
                    value={settings.linkColor || '#1473d1'}
                    onChange={e => updateSetting('linkColor', e.target.value)}
                    className="flex-1 text-[11px] rounded-lg border border-slate-200 px-1.5 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Button defaults */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu nền nút mặc định</label>
                <div className="flex gap-1">
                  <input
                    type="color"
                    value={settings.btnDefaultBg || '#1473d1'}
                    onChange={e => updateSetting('btnDefaultBg', e.target.value)}
                    className="w-7 h-7 rounded-md cursor-pointer border border-slate-200 p-0.5 bg-white"
                  />
                  <input
                    type="text"
                    value={settings.btnDefaultBg || '#1473d1'}
                    onChange={e => updateSetting('btnDefaultBg', e.target.value)}
                    className="flex-1 text-[11px] rounded-lg border border-slate-200 px-1.5 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu chữ nút mặc định</label>
                <div className="flex gap-1">
                  <input
                    type="color"
                    value={settings.btnDefaultTextColor || '#ffffff'}
                    onChange={e => updateSetting('btnDefaultTextColor', e.target.value)}
                    className="w-7 h-7 rounded-md cursor-pointer border border-slate-200 p-0.5 bg-white"
                  />
                  <input
                    type="text"
                    value={settings.btnDefaultTextColor || '#ffffff'}
                    onChange={e => updateSetting('btnDefaultTextColor', e.target.value)}
                    className="flex-1 text-[11px] rounded-lg border border-slate-200 px-1.5 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
