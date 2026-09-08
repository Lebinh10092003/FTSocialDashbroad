import { useRef, useState } from 'react';
import { ImagePlus, Palette, RotateCcw, X } from 'lucide-react';

export type WorkspaceThemeId = 'light' | 'dark' | 'blue' | 'green' | 'pink' | 'lavender' | 'peach' | 'custom';
export type WorkspaceAppearance = { theme: WorkspaceThemeId; customColor: string; backgroundImage: string };

export const DEFAULT_APPEARANCE: WorkspaceAppearance = { theme: 'light', customColor: '#8b5cf6', backgroundImage: '' };
export const APPEARANCE_STORAGE_KEY = 'ft-workspace-appearance-v1';

export function readWorkspaceAppearance(): WorkspaceAppearance {
  try {
    const stored = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null');
    return stored?.theme ? { ...DEFAULT_APPEARANCE, ...stored } : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

const themes: Array<{ id: WorkspaceThemeId; name: string; colors: [string, string, string] }> = [
  { id: 'light', name: 'Sáng', colors: ['#f8fafc', '#eaf1ff', '#ffffff'] },
  { id: 'dark', name: 'Tối', colors: ['#0f172a', '#1e293b', '#334155'] },
  { id: 'blue', name: 'Xanh trời', colors: ['#dbeafe', '#e0f2fe', '#eff6ff'] },
  { id: 'green', name: 'Xanh lá', colors: ['#dcfce7', '#d1fae5', '#f0fdf4'] },
  { id: 'pink', name: 'Hồng', colors: ['#fce7f3', '#ffe4e6', '#fdf2f8'] },
  { id: 'lavender', name: 'Oải hương', colors: ['#ede9fe', '#f3e8ff', '#faf5ff'] },
  { id: 'peach', name: 'Cam đào', colors: ['#ffedd5', '#fef3c7', '#fff7ed'] },
  { id: 'custom', name: 'Màu tùy chỉnh', colors: ['#ede9fe', '#ddd6fe', '#f5f3ff'] },
];

async function resizeBackground(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Vui lòng chọn một tệp ảnh.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Ảnh nền không được vượt quá 12 MB.');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc ảnh nền.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Ảnh nền không hợp lệ.'));
    element.src = source;
  });
  const scale = Math.min(1, 1920 / image.width, 1200 / image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export default function AppearanceSettings({ value, onChange, onClose }: { value: WorkspaceAppearance; onChange: (value: WorkspaceAppearance) => void; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      onChange({ ...value, backgroundImage: await resizeBackground(file) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể dùng ảnh nền này.');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="appearance-settings-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/60 bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-blue-600">Cá nhân hóa Workspace</p><h2 id="appearance-settings-title" className="mt-1 text-2xl font-extrabold text-slate-900">Tùy chỉnh giao diện</h2><p className="mt-2 text-sm text-slate-500">Áp dụng trước cho trang chủ và được ghi nhớ trên trình duyệt này.</p></div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" aria-label="Đóng"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {themes.map(theme => <button key={theme.id} type="button" onClick={() => onChange({ ...value, theme: theme.id })} className={`rounded-2xl border p-3 text-left transition ${value.theme === theme.id ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'}`}>
            <span className="flex h-12 overflow-hidden rounded-xl border border-white/70 shadow-inner">{theme.colors.map(color => <i key={color} className="flex-1" style={{ background: color }} />)}</span>
            <b className="mt-2 block text-sm text-slate-800">{theme.name}</b>
          </button>)}
        </div>

        {value.theme === 'custom' && <label className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"><span><b className="block text-sm text-slate-800">Màu chủ đạo</b><small className="text-slate-500">Workspace tự phối nền pastel từ màu bạn chọn.</small></span><input type="color" value={value.customColor} onChange={event => onChange({ ...value, customColor: event.target.value })} className="h-11 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" /></label>}

        <div className="mt-5 rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><b className="text-sm text-slate-800">Ảnh nền trang chủ</b><p className="mt-1 text-xs text-slate-500">Hỗ trợ JPG, PNG, WebP; ảnh được tối ưu trước khi lưu.</p></div><div className="flex gap-2"><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { void upload(event.target.files?.[0]); event.currentTarget.value = ''; }} /><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white"><ImagePlus className="h-4 w-4" />Tải ảnh nền</button>{value.backgroundImage && <button type="button" onClick={() => onChange({ ...value, backgroundImage: '' })} className="rounded-xl border px-4 py-2.5 text-xs font-bold text-slate-600">Bỏ ảnh</button>}</div></div>
          {value.backgroundImage && <div className="mt-4 h-36 rounded-xl bg-cover bg-center" style={{ backgroundImage: `url(${value.backgroundImage})` }} />}
          {error && <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
        </div>

        <div className="mt-7 flex flex-wrap justify-between gap-3 border-t pt-5"><button type="button" onClick={() => onChange(DEFAULT_APPEARANCE)} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold text-slate-600"><RotateCcw className="h-4 w-4" />Khôi phục mặc định</button><button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white"><Palette className="h-4 w-4" />Xong</button></div>
      </section>
    </div>
  );
}
