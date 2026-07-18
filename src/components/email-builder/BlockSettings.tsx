import React from 'react';
import { AlignCenter, AlignLeft, AlignRight, Link2, Lock, LockOpen, Plus, Search, Trash2, Upload } from 'lucide-react';
import { EmailBlock } from '../../types/emailBuilder';
import { addEmailLayoutCell, getLayoutSlotIndex, normalizeEmailLayout, removeEmailLayoutCell, resizeEmailLayout, updateEmailLayoutCell, updateEmailLayoutColumn } from '../../lib/emailLayout';
import { getBlockDefinition } from '../../data/emailBlockRegistry';
import ColorField from './ColorField';
import { EMAIL_ICON_CATEGORY_LABELS, EMAIL_ICON_LIBRARY, EmailIconOption } from '../../data/emailIconLibrary';
import { getEmailLucideIcon } from '../../lib/emailIcon';

interface BlockSettingsProps {
  block: EmailBlock;
  onUpdateBlockContent: (content: Record<string, any>) => void;
  onUpdateBlockStyles: (styles: Record<string, any>) => void;
  onUpdateBlockColumns?: (columns: EmailBlock[][]) => void;
  onUpdateBlock?: (block: EmailBlock) => void;
  onApplySelectionFontSize?: (size: number) => boolean;
  onApplySelectionTextColor?: (color: string) => boolean;
}

const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none shadow-sm focus:border-blue-500';
const LABELS: Record<string, string> = {
  heading: 'Tiêu đề', title: 'Tiêu đề', body: 'Nội dung', text: 'Nội dung', name: 'Tên', company: 'Đơn vị',
  author: 'Tác giả', role: 'Vai trò', quote: 'Nội dung trích dẫn', description: 'Mô tả', price: 'Giá',
  navigation: 'Điều hướng', address: 'Địa chỉ', link: 'Liên kết', url: 'Đường dẫn', label: 'Nhãn',
  imageUrl: 'Đường dẫn ảnh', logoUrl: 'Đường dẫn logo', borderColor: 'Màu đường viền',
  unsubscribeUrl: 'Liên kết hủy đăng ký', bg: 'Màu nền', padding: 'Khoảng đệm (px)', gap: 'Khoảng cách giữa các nút (px)',
  fontSize: 'Cỡ chữ (px)', paddingX: 'Đệm ngang (px)', paddingY: 'Đệm dọc (px)', minWidth: 'Rộng tối thiểu (px)',
  radius: 'Bo góc (px)', color: 'Màu chữ', features: 'Tính năng', items: 'Các mục',
  images: 'Danh sách ảnh', products: 'Danh sách sản phẩm', plans: 'Các gói giá', links: 'Các liên kết'
};

const COLOR_KEYS = new Set(['bg', 'color', 'background', 'backgroundColor', 'borderColor', 'textColor', 'linkColor', 'headerBg', 'headerColor', 'bodyBg', 'bodyColor', 'headingColor']);

function NumberDraft({ value, min = 0, max = 2000, onCommit, label }: { value: number | string | null | undefined; min?: number; max?: number; onCommit: (value: number | '') => void; label: string }) {
  const [draft, setDraft] = React.useState(value === null || value === undefined ? '' : String(value));
  React.useEffect(() => setDraft(value === null || value === undefined ? '' : String(value)), [value]);
  const commit = (raw: string) => {
    if (raw.trim() === '') { onCommit(''); return; }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onCommit(Math.max(min, Math.min(max, parsed)));
  };
  return <div><label className="mb-1 block text-[10px] font-bold text-slate-500">{label}</label><input type="number" min={min} max={max} value={draft} onChange={event => { setDraft(event.target.value); if (event.target.value !== '') commit(event.target.value); }} onBlur={() => commit(draft)} className={fieldClass} /></div>;
}

export default function BlockSettings({ block, onUpdateBlockContent, onUpdateBlockStyles, onUpdateBlockColumns, onUpdateBlock, onApplySelectionFontSize, onApplySelectionTextColor }: BlockSettingsProps) {
  const content = block.content;
  const styles = block.styles;
  const definition = getBlockDefinition(block.type);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState('');
  const [iconQuery, setIconQuery] = React.useState('');
  const [iconCategory, setIconCategory] = React.useState<'all' | EmailIconOption['category']>('all');
  const updateContent = (key: string, value: any) => onUpdateBlockContent({ ...content, [key]: value });
  const updateStyles = (key: string, value: any) => onUpdateBlockStyles({ ...styles, [key]: value });

  const applyImageMetadata = (url: string) => {
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
      const width = Number(content.width) || Math.min(image.naturalWidth, 600);
      onUpdateBlockContent({ ...content, url, width, height: content.height || Math.round(width / ratio), naturalRatio: ratio, aspectLocked: content.aspectLocked !== false });
    };
    image.src = url;
  };

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith('image/')) { setUploadError('Vui lòng chọn tệp hình ảnh hợp lệ.'); return; }
    if (file.size > 3 * 1024 * 1024) { setUploadError('Tệp quá lớn. Kích thước tối đa là 3MB.'); return; }
    setUploading(true); setUploadError('');
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      try {
        const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
        const result = await response.json();
        applyImageMetadata(result.success && result.url ? `${window.location.origin}${result.url}` : dataUrl);
      } catch { applyImageMetadata(dataUrl); }
      setUploading(false);
    };
    reader.onerror = () => { setUploadError('Không thể đọc dữ liệu tệp.'); setUploading(false); };
    reader.readAsDataURL(file);
  };

  const uploadIconImage = (file: File) => {
    if (!file.type.startsWith('image/')) { setUploadError('Vui lòng chọn tệp hình ảnh hợp lệ.'); return; }
    if (file.size > 3 * 1024 * 1024) { setUploadError('Tệp quá lớn. Kích thước tối đa là 3MB.'); return; }
    setUploading(true); setUploadError('');
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      let iconUrl = dataUrl;
      try {
        const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
        const result = await response.json();
        if (result.success && result.url) iconUrl = `${window.location.origin}${result.url}`;
      } catch { /* keep portable data URL */ }
      onUpdateBlockContent({ ...content, iconSource: 'upload', iconUrl });
      setUploading(false);
    };
    reader.onerror = () => { setUploadError('Không thể đọc dữ liệu tệp.'); setUploading(false); };
    reader.readAsDataURL(file);
  };

  const filteredIcons = EMAIL_ICON_LIBRARY.filter(option => {
    const matchesCategory = iconCategory === 'all' || option.category === iconCategory;
    const query = iconQuery.trim().toLocaleLowerCase('vi');
    return matchesCategory && (!query || `${option.label} ${option.name}`.toLocaleLowerCase('vi').includes(query));
  });

  const ImageUploader = () => <div className="space-y-2">
    <label className="block text-[10px] font-bold text-slate-500">Tải ảnh hoặc dán ảnh (Ctrl+V)</label>
    <label onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) uploadImage(file); }} onPaste={event => { const file = [...event.clipboardData.items].find(item => item.type.startsWith('image/'))?.getAsFile(); if (file) { event.preventDefault(); uploadImage(file); } }} className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center hover:border-blue-400" tabIndex={0}>
      <input type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadImage(file); event.currentTarget.value = ''; }} />
      <span className="text-xs font-bold text-slate-700">{uploading ? 'Đang tải ảnh…' : 'Kéo thả, bấm chọn hoặc dán ảnh'}</span>
      <span className="mt-1 text-[9px] text-slate-400">JPG, PNG, GIF, WebP — tối đa 3MB</span>
    </label>
    {uploadError && <p className="rounded-lg bg-rose-50 p-2 text-[10px] font-bold text-rose-600">{uploadError}</p>}
  </div>;

  const alignControl = <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Căn ngang</label><div className="flex rounded-xl border border-slate-200 bg-slate-100 p-0.5">{(['left', 'center', 'right'] as const).map(align => <button key={align} type="button" onClick={() => updateContent('align', align)} className={`flex-1 rounded-lg py-1.5 ${content.align === align ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>{align === 'left' ? <AlignLeft className="mx-auto h-4 w-4" /> : align === 'center' ? <AlignCenter className="mx-auto h-4 w-4" /> : <AlignRight className="mx-auto h-4 w-4" />}</button>)}</div></div>;

  const changeImageDimension = (key: 'width' | 'height', value: number | '') => {
    if (value === '') { updateContent(key, ''); return; }
    const ratio = Number(content.naturalRatio) || (Number(content.width) && Number(content.height) ? Number(content.width) / Number(content.height) : 1);
    if (content.aspectLocked !== false && ratio > 0) {
      onUpdateBlockContent({ ...content, [key]: value, [key === 'width' ? 'height' : 'width']: Math.round(key === 'width' ? value / ratio : value * ratio) });
    } else updateContent(key, value);
  };

  const rows: string[][] = Array.isArray(content.rows) ? content.rows : [];
  const updateTableCell = (rowIndex: number, columnIndex: number, value: string) => {
    const next = rows.map(row => [...row]); next[rowIndex][columnIndex] = value; updateContent('rows', next);
  };

  const primitiveEntries = Object.entries(content).filter(([key, value]) => !['variant', 'url', 'alt', 'width', 'height', 'aspectLocked', 'naturalRatio', 'align', 'borderRadius', 'items', 'rows', 'html', 'fontSize', 'lineHeight'].includes(key) && (typeof value === 'string' || typeof value === 'number'));
  const isButtonGroup = block.type === 'button-group' || block.type === 'button-group-3';
  const showGenericFields = !['logo', 'heading', 'paragraph', 'image', 'icon-text', 'columns', 'data-table', 'bullet-list', 'number-list', 'spacer', 'button', 'button-group', 'button-group-3'].includes(block.type);
  const collectionEntries = Object.entries(content).filter(([key, value]) => Array.isArray(value) && key !== 'rows' && key !== 'layoutColumns' && !(isButtonGroup && key === 'buttons') && !(key === 'items' && ['bullet-list', 'number-list', 'columns'].includes(block.type)));
  const updateCollectionItem = (key: string, index: number, value: any) => {
    const next = [...(content[key] || [])]; next[index] = value; updateContent(key, next);
  };
  const addCollectionItem = (key: string, items: any[]) => {
    const sample = items[0];
    const next = typeof sample === 'string' ? '' : sample && typeof sample === 'object' ? Object.fromEntries(Object.keys(sample).map(field => [field, ''])) : '';
    updateContent(key, [...items, next]);
  };
  const groupButtons = (): any[] => content.buttons || [content.btn1, content.btn2].filter(Boolean);
  const updateGroupButton = (index: number, patch: Record<string, any>) => {
    const buttons = groupButtons().map(button => ({ ...button }));
    buttons[index] = { ...buttons[index], ...patch };
    onUpdateBlockContent({ ...content, buttons });
  };
  const addGroupButton = () => {
    const buttons = groupButtons();
    if (buttons.length >= 3) return;
    onUpdateBlockContent({ ...content, buttons: [...buttons, { text: `Nút thứ ${buttons.length + 1}`, link: 'https://www.fermat.vn', bg: '#1473d1', color: '#ffffff', radius: 8, fontSize: 13, paddingX: 14, paddingY: 10, minWidth: 0 }] });
  };
  const layoutState = block.type === 'columns' ? normalizeEmailLayout(block) : null;
  const commitLayout = (nextBlock: EmailBlock) => {
    if (onUpdateBlock) onUpdateBlock(nextBlock);
    else {
      onUpdateBlockContent(nextBlock.content);
      onUpdateBlockColumns?.(nextBlock.columns || []);
    }
  };
  const setLayoutCount = (count: number) => {
    if (!layoutState) return;
    if (count < layoutState.layout.length) {
      const keepSlots = layoutState.layout.slice(0, count).reduce((total, column) => total + column.cells.length, 0);
      if (layoutState.slots.slice(keepSlots).some(slot => slot.length) && !confirm('Các ô bị xóa đang chứa nội dung. Bạn có chắc muốn giảm số cột?')) return;
    }
    commitLayout(resizeEmailLayout(block, count));
  };
  const removeLayoutCellSafely = (columnIndex: number, cellIndex: number) => {
    if (!layoutState) return;
    const slotIndex = getLayoutSlotIndex(layoutState.layout, columnIndex, cellIndex);
    if (layoutState.slots[slotIndex]?.length && !confirm('Ô này đang chứa nội dung. Bạn có chắc muốn xóa ô?')) return;
    commitLayout(removeEmailLayoutCell(block, columnIndex, cellIndex));
  };

  return <div className="h-full space-y-5 overflow-y-auto bg-white p-5 text-slate-800">
    <div className="border-b border-slate-100 pb-3"><h3 className="text-xs font-black uppercase tracking-widest">Thuộc tính khối</h3><p className="mt-1 text-[10px] font-bold text-slate-400">Phân loại: <span className="rounded border border-blue-100 bg-blue-50 px-2 py-0.5 uppercase text-blue-700">{block.type}</span></p></div>

    {block.type !== 'spacer' && <section className="rounded-xl border border-slate-200 bg-slate-50 p-3.5"><h4 className="mb-2 text-[10px] font-black uppercase tracking-wider">Khoảng cách lề (px)</h4><div className="grid grid-cols-2 gap-3"><NumberDraft label="Lề trên" value={styles.marginTop ?? 10} max={100} onCommit={value => updateStyles('marginTop', value === '' ? 0 : value)} /><NumberDraft label="Lề dưới" value={styles.marginBottom ?? 10} max={100} onCommit={value => updateStyles('marginBottom', value === '' ? 0 : value)} /></div></section>}

    {(block.type === 'image' || block.type === 'logo') && <div className="space-y-4"><ImageUploader /><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Đường dẫn ảnh HTTPS</label><input value={content.url || ''} onChange={event => updateContent('url', event.target.value)} onBlur={() => content.url && applyImageMetadata(content.url)} placeholder="https://example.com/image.png" className={fieldClass} /></div><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Mô tả ảnh (Alt text)</label><input value={content.alt || ''} onChange={event => updateContent('alt', event.target.value)} className={fieldClass} /></div>
      <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-3"><div className="mb-2 flex items-center justify-between"><h4 className="text-[10px] font-black uppercase">Kích thước ảnh</h4><button type="button" onClick={() => updateContent('aspectLocked', content.aspectLocked === false)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${content.aspectLocked !== false ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`} title="Khóa tỉ lệ chiều rộng và chiều cao">{content.aspectLocked !== false ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}{content.aspectLocked !== false ? 'Đang khóa tỉ lệ' : 'Tự do'}</button></div><div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2"><NumberDraft label="Chiều rộng (px)" value={content.width} min={1} max={2000} onCommit={value => changeImageDimension('width', value)} /><Link2 className={`mb-2 h-4 w-4 ${content.aspectLocked !== false ? 'text-blue-600' : 'text-slate-300'}`} /><NumberDraft label="Chiều cao (px)" value={content.height} min={1} max={2000} onCommit={value => changeImageDimension('height', value)} /></div><p className="mt-2 text-[9px] leading-relaxed text-slate-500">Có thể xóa trắng hoàn toàn một ô rồi nhập số mới. Khi khóa tỉ lệ, thay đổi một chiều sẽ tự cập nhật chiều còn lại.</p></section>
      {block.type === 'image' && <NumberDraft label="Bo góc ảnh (px)" value={content.borderRadius ?? 0} max={100} onCommit={value => updateContent('borderRadius', value === '' ? 0 : value)} />}{alignControl}<div><label className="mb-1 block text-[10px] font-bold text-slate-500">Liên kết khi bấm vào ảnh</label><input value={content.link || ''} onChange={event => updateContent('link', event.target.value)} className={fieldClass} /></div></div>}

    {block.type === 'icon-text' && <div className="space-y-4">
      <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Nội dung cùng dòng</label><textarea value={content.text || ''} onChange={event => updateContent('text', event.target.value)} className={`${fieldClass} min-h-20`} /></div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => updateContent('iconSource', 'library')} className={`rounded-lg py-2 text-[10px] font-black ${content.iconSource !== 'upload' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>Thư viện icon</button><button type="button" onClick={() => updateContent('iconSource', 'upload')} className={`rounded-lg py-2 text-[10px] font-black ${content.iconSource === 'upload' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>Tải ảnh icon</button></div>
      {content.iconSource !== 'upload' ? <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="relative"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" /><input value={iconQuery} onChange={event => setIconQuery(event.target.value)} placeholder="Tìm icon: lịch, trường học, cảnh báo…" className={`${fieldClass} pl-8`} /></div>
        <div className="flex gap-1 overflow-x-auto pb-1"><button type="button" onClick={() => setIconCategory('all')} className={`shrink-0 rounded-lg px-2 py-1 text-[8px] font-black ${iconCategory === 'all' ? 'bg-blue-600 text-white' : 'border bg-white text-slate-500'}`}>Tất cả</button>{Object.entries(EMAIL_ICON_CATEGORY_LABELS).map(([key, label]) => <button key={key} type="button" onClick={() => setIconCategory(key as EmailIconOption['category'])} className={`shrink-0 rounded-lg px-2 py-1 text-[8px] font-black ${iconCategory === key ? 'bg-blue-600 text-white' : 'border bg-white text-slate-500'}`}>{label}</button>)}</div>
        <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(42px,1fr))] gap-1.5 overflow-y-auto pr-1">{filteredIcons.map(option => { const Icon = getEmailLucideIcon(option.name); return <button key={option.name} type="button" onClick={() => onUpdateBlockContent({ ...content, iconSource: 'library', iconName: option.name })} title={option.label} className={`flex aspect-square min-h-10 items-center justify-center rounded-lg border transition hover:border-blue-400 hover:bg-blue-50 ${content.iconName === option.name ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-400' : 'border-slate-200 bg-white text-slate-600'}`}>{Icon ? <Icon size={18} /> : null}</button>; })}</div>
        {!filteredIcons.length && <p className="py-4 text-center text-[10px] font-bold text-slate-400">Không tìm thấy icon phù hợp.</p>}
      </section> : <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
        <label onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) uploadIconImage(file); }} className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-200 bg-white p-3 text-center hover:border-blue-400"><input type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadIconImage(file); event.currentTarget.value = ''; }} /><Upload className="mb-2 h-5 w-5 text-blue-600" /><span className="text-[10px] font-bold text-slate-700">{uploading ? 'Đang tải icon…' : 'Bấm hoặc kéo ảnh icon vào đây'}</span><span className="mt-1 text-[8px] text-slate-400">PNG nền trong suốt được khuyến nghị · tối đa 3MB</span></label>
        <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Đường dẫn ảnh icon</label><input value={content.iconUrl || ''} onChange={event => updateContent('iconUrl', event.target.value)} placeholder="https://…" className={fieldClass} /></div>
        {content.iconUrl && <div className="flex justify-center rounded-lg border bg-white p-3"><img src={content.iconUrl} alt="Xem trước icon" style={{ width: Number(content.iconSize) || 24, height: Number(content.iconSize) || 24 }} className="object-contain" /></div>}
      </section>}
      {uploadError && <p className="rounded-lg bg-rose-50 p-2 text-[10px] font-bold text-rose-600">{uploadError}</p>}
      <div className="grid grid-cols-2 gap-3"><NumberDraft label="Kích thước icon (px)" value={content.iconSize ?? 24} min={8} max={160} onCommit={value => updateContent('iconSize', value === '' ? 24 : value)} /><NumberDraft label="Khoảng cách icon–chữ (px)" value={content.gap ?? 10} max={80} onCommit={value => updateContent('gap', value === '' ? 0 : value)} /><NumberDraft label="Cỡ chữ (px)" value={content.fontSize ?? 15} min={10} max={72} onCommit={value => updateContent('fontSize', value === '' ? 15 : value)} /></div>
      <div className="grid grid-cols-2 gap-2">{content.iconSource !== 'upload' && <ColorField label="Màu icon" value={content.iconColor || '#1473D1'} onChange={value => updateContent('iconColor', value)} />}<ColorField label="Màu chữ" value={content.color || '#1E293B'} onChange={value => updateContent('color', value)} /></div>
      {alignControl}
      <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Căn icon theo chiều dọc</label><select value={content.verticalAlign || 'middle'} onChange={event => updateContent('verticalAlign', event.target.value)} className={fieldClass}><option value="top">Theo đỉnh dòng chữ</option><option value="middle">Giữa dòng chữ</option><option value="bottom">Theo đáy dòng chữ</option></select></div>
    </div>}

    {block.type === 'heading' && <div className="space-y-4"><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Nội dung tiêu đề</label><input value={content.text || ''} onChange={event => updateContent('text', event.target.value)} className={fieldClass} /></div><div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Cấp tiêu đề</label><select value={content.level || 'h2'} onChange={event => updateContent('level', event.target.value)} className={fieldClass}><option value="h1">H1 — Chính</option><option value="h2">H2 — Phụ</option><option value="h3">H3 — Mục nhỏ</option></select></div><NumberDraft label="Cỡ chữ (px)" value={content.fontSize ?? 20} min={10} max={72} onCommit={value => updateContent('fontSize', value === '' ? 20 : value)} /></div><ColorField label="Màu chữ" value={content.color || '#0F3A72'} onChange={value => updateContent('color', value)} />{alignControl}</div>}

    {['paragraph', 'signature', 'highlight-box'].includes(block.type) && <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5"><h4 className="text-[10px] font-black uppercase">Định dạng mặc định email-safe</h4><div className="grid grid-cols-2 gap-3"><NumberDraft label="Cỡ chữ (px)" value={content.fontSize ?? 15} min={10} max={48} onCommit={value => { const size = value === '' ? 15 : value; if (!onApplySelectionFontSize?.(size)) updateContent('fontSize', size); }} /><NumberDraft label="Giãn dòng" value={content.lineHeight ?? 1.6} min={1} max={2.4} onCommit={value => updateContent('lineHeight', value === '' ? 1.6 : value)} /></div><ColorField label="Màu chữ mặc định" value={content.color || '#1E293B'} onChange={value => { if (!onApplySelectionTextColor?.(value)) updateContent('color', value); }} />{alignControl}<p className="text-[9px] text-slate-500">Bôi đen văn bản trên canvas để đổi riêng cỡ chữ hoặc màu chữ cho vùng đã chọn.</p></section>}

    {block.type === 'columns' && layoutState && <section className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5">
      <div>
        <div className="mb-2 flex items-center justify-between"><h4 className="text-[10px] font-black uppercase">Bố cục ô linh hoạt</h4><span className="text-[9px] font-bold text-slate-400">Tối đa 4 × 4</span></div>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">{[1, 2, 3, 4].map(count => <button key={count} type="button" onClick={() => setLayoutCount(count)} className={`rounded-lg py-2 text-[10px] font-black ${layoutState.layout.length === count ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:bg-white/60'}`}>{count} cột</button>)}</div>
      </div>
      <div className="grid grid-cols-2 gap-2"><NumberDraft label="Cách cột (px)" value={content.horizontalGap ?? 12} max={48} onCommit={value => commitLayout({ ...block, content: { ...content, horizontalGap: value === '' ? 0 : value } })} /><NumberDraft label="Cách ô dọc (px)" value={content.verticalGap ?? 12} max={48} onCommit={value => commitLayout({ ...block, content: { ...content, verticalGap: value === '' ? 0 : value } })} /></div>
      <p className="text-[9px] leading-relaxed text-slate-500">Mỗi cột có tỷ lệ rộng riêng và có thể chia thành tối đa bốn ô trên–dưới. Kéo bất kỳ block nào vào từng ô trên canvas.</p>
      {layoutState.layout.map((column, columnIndex) => <div key={column.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-end justify-between gap-2"><div className="min-w-0 flex-1"><NumberDraft label={`Tỷ lệ rộng cột ${columnIndex + 1}`} value={column.width} min={1} max={6} onCommit={value => commitLayout(updateEmailLayoutColumn(block, columnIndex, { width: value === '' ? 1 : value }))} /></div><button type="button" disabled={column.cells.length >= 4} onClick={() => commitLayout(addEmailLayoutCell(block, columnIndex))} className="mb-0.5 inline-flex h-9 items-center gap-1 rounded-lg border border-blue-200 px-2 text-[9px] font-bold text-blue-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Thêm ô</button></div>
        {column.cells.map((cell, cellIndex) => <div key={cell.id} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          <div className="flex items-center justify-between"><p className="text-[9px] font-black uppercase text-slate-600">Ô {columnIndex + 1}.{cellIndex + 1}</p>{column.cells.length > 1 && <button type="button" onClick={() => removeLayoutCellSafely(columnIndex, cellIndex)} className="rounded p-1 text-rose-500 hover:bg-rose-50" title="Xóa ô"><Trash2 className="h-3.5 w-3.5" /></button>}</div>
          <div className="grid grid-cols-2 gap-2"><ColorField label="Màu nền ô" value={cell.background} onChange={value => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { background: value }))} /><ColorField label="Màu chữ ô" value={cell.color || '#1e293b'} onChange={value => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { color: value }))} /></div>
          <div className="grid grid-cols-2 gap-2"><NumberDraft label="Đệm trong (px)" value={cell.padding} max={64} onCommit={value => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { padding: value === '' ? 0 : value }))} /><NumberDraft label="Cao tối thiểu (px)" value={cell.minHeight} min={32} max={600} onCommit={value => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { minHeight: value === '' ? 32 : value }))} /><NumberDraft label="Độ dày viền (px)" value={cell.borderWidth} max={12} onCommit={value => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { borderWidth: value === '' ? 0 : value }))} /><NumberDraft label="Bo góc (px)" value={cell.borderRadius} max={80} onCommit={value => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { borderRadius: value === '' ? 0 : value }))} /></div>
          <ColorField label="Màu viền ô" value={cell.borderColor} onChange={value => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { borderColor: value }))} />
          <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Căn nội dung theo chiều dọc</label><select value={cell.verticalAlign} onChange={event => commitLayout(updateEmailLayoutCell(block, columnIndex, cellIndex, { verticalAlign: event.target.value as any }))} className={fieldClass}><option value="top">Trên</option><option value="middle">Giữa</option><option value="bottom">Dưới</option></select></div>
        </div>)}
      </div>)}
    </section>}

    {block.type === 'data-table' && <div className="space-y-3"><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Tiêu đề bảng</label><input value={content.heading || ''} onChange={event => updateContent('heading', event.target.value)} className={fieldClass} /></div><div className="space-y-2">{rows.map((row, rowIndex) => <div key={rowIndex} className="flex gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">{row.map((cell, columnIndex) => <input key={columnIndex} value={cell} onChange={event => updateTableCell(rowIndex, columnIndex, event.target.value)} className={`${fieldClass} min-w-0`} />)}<button type="button" onClick={() => updateContent('rows', rows.filter((_, index) => index !== rowIndex))} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50" title="Xóa dòng"><Trash2 className="h-4 w-4" /></button></div>)}</div><div className="flex gap-2"><button type="button" onClick={() => updateContent('rows', [...rows, Array.from({ length: Math.max(2, rows[0]?.length || 2) }, () => '')])} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm dòng</button><button type="button" onClick={() => updateContent('rows', rows.map(row => [...row, '']))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600"><Plus className="h-3.5 w-3.5" />Thêm cột</button></div><p className="text-[9px] text-slate-500">Dòng đầu tiên được xuất dưới dạng hàng tiêu đề của bảng.</p></div>}

    {(block.type === 'bullet-list' || block.type === 'number-list') && <div className="space-y-2"><div className="flex items-center justify-between"><label className="text-[10px] font-bold text-slate-500">Các mục danh sách</label><button type="button" onClick={() => updateContent('items', [...(content.items || []), 'Mục mới'])} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm mục</button></div><ColorField label="Màu chữ danh sách" value={content.color || '#1E293B'} onChange={value => updateContent('color', value)} />{(content.items || []).map((item: string, index: number) => <div key={index} className="flex gap-2"><input value={item} onChange={event => { const next = [...content.items]; next[index] = event.target.value; updateContent('items', next); }} className={fieldClass} /><button type="button" onClick={() => updateContent('items', content.items.filter((_: string, itemIndex: number) => itemIndex !== index))} className="p-2 text-rose-500"><Trash2 className="h-4 w-4" /></button></div>)}</div>}

    {block.type === 'divider' && <section className="space-y-3"><ColorField label="Màu đường phân cách" value={styles.color || '#E2E8F0'} onChange={value => updateStyles('color', value)} /><NumberDraft label="Độ dày (px)" value={styles.thickness ?? 1} min={1} max={12} onCommit={value => updateStyles('thickness', value === '' ? 1 : value)} /></section>}

    {block.type === 'spacer' && <NumberDraft label="Chiều cao khoảng trắng (px)" value={styles.height ?? 20} min={5} max={150} onCommit={value => updateStyles('height', value === '' ? 20 : value)} />}

    {definition.variants.length > 1 && !['columns'].includes(block.type) && <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Biến thể giao diện</label><select value={content.variant || definition.variants[0].value} onChange={event => updateContent('variant', event.target.value)} className={fieldClass}>{definition.variants.map(variant => <option key={variant.value} value={variant.value}>{variant.label}</option>)}</select></div>}

    {block.type === 'button' && <section className="space-y-3">
      <h4 className="text-[10px] font-black uppercase">Nút CTA</h4>
      <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Nhãn nút</label><input value={content.text || ''} onChange={event => updateContent('text', event.target.value)} className={fieldClass} /></div>
      <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Liên kết</label><input value={content.link || ''} onChange={event => updateContent('link', event.target.value)} className={fieldClass} /></div>
      <div className="grid grid-cols-2 gap-2"><NumberDraft label="Cỡ chữ (px)" value={content.fontSize ?? 15} min={10} max={30} onCommit={value => updateContent('fontSize', value === '' ? 15 : value)} /><NumberDraft label="Rộng tối thiểu (px)" value={content.minWidth ?? 0} max={600} onCommit={value => updateContent('minWidth', value === '' ? 0 : value)} /><NumberDraft label="Đệm ngang (px)" value={content.paddingX ?? 24} max={100} onCommit={value => updateContent('paddingX', value === '' ? 24 : value)} /><NumberDraft label="Đệm dọc (px)" value={content.paddingY ?? 12} max={60} onCommit={value => updateContent('paddingY', value === '' ? 12 : value)} /><NumberDraft label="Bo góc (px)" value={content.radius ?? 8} max={80} onCommit={value => updateContent('radius', value === '' ? 8 : value)} /></div>
      <div><label className="mb-1 block text-[10px] font-bold text-slate-500">Độ rộng nút</label><select value={content.width || 'auto'} onChange={event => updateContent('width', event.target.value)} className={fieldClass}><option value="auto">Theo nội dung</option><option value="full">Toàn chiều rộng</option></select></div>
      {alignControl}
      <div className="grid grid-cols-2 gap-2"><ColorField label="Màu nền" value={content.bg || '#1473d1'} onChange={value => updateContent('bg', value)} /><ColorField label="Màu chữ" value={content.color || '#ffffff'} onChange={value => updateContent('color', value)} /></div>
    </section>}
    {showGenericFields && primitiveEntries.map(([key, value]) => <div key={key}><label className="mb-1 block text-[10px] font-bold text-slate-500">{LABELS[key] || key}</label>{key === 'body' || key === 'description' || key === 'quote' ? <textarea value={String(value)} onChange={event => updateContent(key, event.target.value)} className={`${fieldClass} min-h-24`} /> : COLOR_KEYS.has(key) ? <ColorField label={LABELS[key] || key} value={String(value)} onChange={next => updateContent(key, next)} /> : <input value={String(value)} onChange={event => updateContent(key, event.target.value)} className={fieldClass} />}</div>)}
    {isButtonGroup && <section className="space-y-3">
      <div className="flex items-center justify-between"><h4 className="text-[10px] font-black uppercase">Các nút hành động</h4>{groupButtons().length < 3 && <button type="button" onClick={addGroupButton} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm nút</button>}</div>
      <div className="grid grid-cols-2 gap-3"><NumberDraft label="Khoảng cách (px)" value={content.gap ?? 12} max={60} onCommit={value => updateContent('gap', value === '' ? 12 : value)} />{alignControl}</div>
      {groupButtons().map((button: any, index: number) => <div key={index} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase">Nút {index + 1}</p>{groupButtons().length > 2 && <button type="button" onClick={() => onUpdateBlockContent({ ...content, buttons: groupButtons().filter((_, buttonIndex) => buttonIndex !== index) })} className="rounded p-1 text-rose-500" title="Xóa nút"><Trash2 className="h-4 w-4" /></button>}</div>
        <input value={button.text || ''} onChange={event => updateGroupButton(index, { text: event.target.value })} placeholder="Nhãn nút" className={fieldClass} />
        <input value={button.link || ''} onChange={event => updateGroupButton(index, { link: event.target.value })} placeholder="https://..." className={fieldClass} />
        <div className="grid grid-cols-2 gap-2"><NumberDraft label="Cỡ chữ (px)" value={button.fontSize ?? 14} min={10} max={30} onCommit={value => updateGroupButton(index, { fontSize: value === '' ? 14 : value })} /><NumberDraft label="Rộng tối thiểu (px)" value={button.minWidth ?? 0} max={400} onCommit={value => updateGroupButton(index, { minWidth: value === '' ? 0 : value })} /><NumberDraft label="Đệm ngang (px)" value={button.paddingX ?? 18} max={80} onCommit={value => updateGroupButton(index, { paddingX: value === '' ? 18 : value })} /><NumberDraft label="Đệm dọc (px)" value={button.paddingY ?? 11} max={50} onCommit={value => updateGroupButton(index, { paddingY: value === '' ? 11 : value })} /><NumberDraft label="Bo góc (px)" value={button.radius ?? 8} max={80} onCommit={value => updateGroupButton(index, { radius: value === '' ? 8 : value })} /></div>
        <div className="grid grid-cols-2 gap-2"><ColorField label="Màu nền" value={button.bg || '#0F3A72'} onChange={value => updateGroupButton(index, { bg: value })} /><ColorField label="Màu chữ" value={button.color || '#ffffff'} onChange={value => updateGroupButton(index, { color: value })} /></div>
      </div>)}
    </section>}

    {collectionEntries.map(([key, rawItems]) => { const items = rawItems as any[]; return <section key={key} className="space-y-2"><div className="flex items-center justify-between"><h4 className="text-[10px] font-black uppercase">{LABELS[key] || key}</h4><button type="button" onClick={() => addCollectionItem(key, items)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm</button></div>{items.map((item, index) => <div key={index} className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">{typeof item === 'string' ? <input value={item} onChange={event => updateCollectionItem(key, index, event.target.value)} className={fieldClass} /> : <div className="grid min-w-0 flex-1 gap-2">{Object.entries(item || {}).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([field, value]) => COLOR_KEYS.has(field) ? <div key={field}><ColorField label={LABELS[field] || field} value={String(value)} onChange={next => updateCollectionItem(key, index, { ...item, [field]: next })} compact /></div> : <label key={field} className="text-[9px] font-bold text-slate-500">{LABELS[field] || field}<input value={String(value)} onChange={event => updateCollectionItem(key, index, { ...item, [field]: event.target.value })} className={`${fieldClass} mt-1`} /></label>)}</div>}<button type="button" onClick={() => updateContent(key, items.filter((_, itemIndex) => itemIndex !== index))} className="h-fit rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button></div>)}</section>; })}
  </div>;
}