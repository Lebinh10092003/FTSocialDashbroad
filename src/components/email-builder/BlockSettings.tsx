import React from 'react';
import { AlignCenter, AlignLeft, AlignRight, Link2, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { EmailBlock } from '../../types/emailBuilder';
import { getBlockDefinition } from '../../data/emailBlockRegistry';
import ColorField from './ColorField';

interface BlockSettingsProps {
  block: EmailBlock;
  onUpdateBlockContent: (content: Record<string, any>) => void;
  onUpdateBlockStyles: (styles: Record<string, any>) => void;
  onUpdateBlockColumns?: (columns: EmailBlock[][]) => void;
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

export default function BlockSettings({ block, onUpdateBlockContent, onUpdateBlockStyles, onUpdateBlockColumns }: BlockSettingsProps) {
  const content = block.content;
  const styles = block.styles;
  const definition = getBlockDefinition(block.type);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState('');
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
  const showGenericFields = !['logo', 'heading', 'paragraph', 'image', 'columns', 'data-table', 'bullet-list', 'number-list', 'spacer', 'button', 'button-group', 'button-group-3'].includes(block.type);
  const collectionEntries = Object.entries(content).filter(([key, value]) => Array.isArray(value) && key !== 'rows' && !(isButtonGroup && key === 'buttons') && !(key === 'items' && ['bullet-list', 'number-list', 'columns'].includes(block.type)));
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

  return <div className="h-full space-y-5 overflow-y-auto bg-white p-5 text-slate-800">
    <div className="border-b border-slate-100 pb-3"><h3 className="text-xs font-black uppercase tracking-widest">Thuộc tính khối</h3><p className="mt-1 text-[10px] font-bold text-slate-400">Phân loại: <span className="rounded border border-blue-100 bg-blue-50 px-2 py-0.5 uppercase text-blue-700">{block.type}</span></p></div>

    {block.type !== 'spacer' && <section className="rounded-xl border border-slate-200 bg-slate-50 p-3.5"><h4 className="mb-2 text-[10px] font-black uppercase tracking-wider">Khoảng cách lề (px)</h4><div className="grid grid-cols-2 gap-3"><NumberDraft label="Lề trên" value={styles.marginTop ?? 10} max={100} onCommit={value => updateStyles('marginTop', value === '' ? 0 : value)} /><NumberDraft label="Lề dưới" value={styles.marginBottom ?? 10} max={100} onCommit={value => updateStyles('marginBottom', value === '' ? 0 : value)} /></div></section>}

    {(block.type === 'image' || block.type === 'logo') && <div className="space-y-4"><ImageUploader /><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Đường dẫn ảnh HTTPS</label><input value={content.url || ''} onChange={event => updateContent('url', event.target.value)} onBlur={() => content.url && applyImageMetadata(content.url)} placeholder="https://example.com/image.png" className={fieldClass} /></div><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Mô tả ảnh (Alt text)</label><input value={content.alt || ''} onChange={event => updateContent('alt', event.target.value)} className={fieldClass} /></div>
      <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-3"><div className="mb-2 flex items-center justify-between"><h4 className="text-[10px] font-black uppercase">Kích thước ảnh</h4><button type="button" onClick={() => updateContent('aspectLocked', content.aspectLocked === false)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${content.aspectLocked !== false ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`} title="Khóa tỉ lệ chiều rộng và chiều cao">{content.aspectLocked !== false ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}{content.aspectLocked !== false ? 'Đang khóa tỉ lệ' : 'Tự do'}</button></div><div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2"><NumberDraft label="Chiều rộng (px)" value={content.width} min={1} max={2000} onCommit={value => changeImageDimension('width', value)} /><Link2 className={`mb-2 h-4 w-4 ${content.aspectLocked !== false ? 'text-blue-600' : 'text-slate-300'}`} /><NumberDraft label="Chiều cao (px)" value={content.height} min={1} max={2000} onCommit={value => changeImageDimension('height', value)} /></div><p className="mt-2 text-[9px] leading-relaxed text-slate-500">Có thể xóa trắng hoàn toàn một ô rồi nhập số mới. Khi khóa tỉ lệ, thay đổi một chiều sẽ tự cập nhật chiều còn lại.</p></section>
      {block.type === 'image' && <NumberDraft label="Bo góc ảnh (px)" value={content.borderRadius ?? 0} max={100} onCommit={value => updateContent('borderRadius', value === '' ? 0 : value)} />}{alignControl}<div><label className="mb-1 block text-[10px] font-bold text-slate-500">Liên kết khi bấm vào ảnh</label><input value={content.link || ''} onChange={event => updateContent('link', event.target.value)} className={fieldClass} /></div></div>}

    {block.type === 'heading' && <div className="space-y-4"><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Nội dung tiêu đề</label><input value={content.text || ''} onChange={event => updateContent('text', event.target.value)} className={fieldClass} /></div><div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Cấp tiêu đề</label><select value={content.level || 'h2'} onChange={event => updateContent('level', event.target.value)} className={fieldClass}><option value="h1">H1 — Chính</option><option value="h2">H2 — Phụ</option><option value="h3">H3 — Mục nhỏ</option></select></div><NumberDraft label="Cỡ chữ (px)" value={content.fontSize ?? 20} min={10} max={72} onCommit={value => updateContent('fontSize', value === '' ? 20 : value)} /></div><ColorField label="Màu chữ" value={content.color || '#0F3A72'} onChange={value => updateContent('color', value)} />{alignControl}</div>}

    {['paragraph', 'signature', 'highlight-box'].includes(block.type) && <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5"><h4 className="text-[10px] font-black uppercase">Định dạng mặc định email-safe</h4><div className="grid grid-cols-2 gap-3"><NumberDraft label="Cỡ chữ (px)" value={content.fontSize ?? 15} min={10} max={48} onCommit={value => updateContent('fontSize', value === '' ? 15 : value)} /><NumberDraft label="Giãn dòng" value={content.lineHeight ?? 1.6} min={1} max={2.4} onCommit={value => updateContent('lineHeight', value === '' ? 1.6 : value)} /></div>{alignControl}<p className="text-[9px] text-slate-500">Bôi đen văn bản trên canvas để đổi riêng cỡ chữ cho vùng đã chọn.</p></section>}

    {block.type === 'columns' && <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5"><div><label className="mb-1 block text-[10px] font-bold text-slate-600">Số cột bằng nhau</label><select value={content.variant || 'two'} onChange={event => { const variant = event.target.value; const count = variant === 'four' ? 4 : variant === 'three' ? 3 : 2; const columns = Array.from({ length: count }, (_, index) => block.columns?.[index] || []); onUpdateBlockContent({ ...content, variant }); onUpdateBlockColumns?.(columns); }} className={fieldClass}><option value="two">2 cột</option><option value="three">3 cột</option><option value="four">4 cột</option></select></div><p className="text-[9px] leading-relaxed text-slate-500">Kéo bất kỳ block nào vào đúng cột trên canvas. Mỗi cột có thể chứa nhiều block và xuất ra HTML dạng bảng tương thích email.</p></section>}

    {block.type === 'data-table' && <div className="space-y-3"><div><label className="mb-1 block text-[10px] font-bold text-slate-500">Tiêu đề bảng</label><input value={content.heading || ''} onChange={event => updateContent('heading', event.target.value)} className={fieldClass} /></div><div className="space-y-2">{rows.map((row, rowIndex) => <div key={rowIndex} className="flex gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">{row.map((cell, columnIndex) => <input key={columnIndex} value={cell} onChange={event => updateTableCell(rowIndex, columnIndex, event.target.value)} className={`${fieldClass} min-w-0`} />)}<button type="button" onClick={() => updateContent('rows', rows.filter((_, index) => index !== rowIndex))} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50" title="Xóa dòng"><Trash2 className="h-4 w-4" /></button></div>)}</div><div className="flex gap-2"><button type="button" onClick={() => updateContent('rows', [...rows, Array.from({ length: Math.max(2, rows[0]?.length || 2) }, () => '')])} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm dòng</button><button type="button" onClick={() => updateContent('rows', rows.map(row => [...row, '']))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600"><Plus className="h-3.5 w-3.5" />Thêm cột</button></div><p className="text-[9px] text-slate-500">Dòng đầu tiên được xuất dưới dạng hàng tiêu đề của bảng.</p></div>}

    {(block.type === 'bullet-list' || block.type === 'number-list') && <div className="space-y-2"><div className="flex items-center justify-between"><label className="text-[10px] font-bold text-slate-500">Các mục danh sách</label><button type="button" onClick={() => updateContent('items', [...(content.items || []), 'Mục mới'])} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm mục</button></div>{(content.items || []).map((item: string, index: number) => <div key={index} className="flex gap-2"><input value={item} onChange={event => { const next = [...content.items]; next[index] = event.target.value; updateContent('items', next); }} className={fieldClass} /><button type="button" onClick={() => updateContent('items', content.items.filter((_: string, itemIndex: number) => itemIndex !== index))} className="p-2 text-rose-500"><Trash2 className="h-4 w-4" /></button></div>)}</div>}

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
    {showGenericFields && primitiveEntries.map(([key, value]) => <div key={key}><label className="mb-1 block text-[10px] font-bold text-slate-500">{LABELS[key] || key}</label>{key === 'body' || key === 'description' || key === 'quote' ? <textarea value={String(value)} onChange={event => updateContent(key, event.target.value)} className={`${fieldClass} min-h-24`} /> : key === 'bg' ? <ColorField label={LABELS[key]} value={String(value)} onChange={next => updateContent(key, next)} /> : <input value={String(value)} onChange={event => updateContent(key, event.target.value)} className={fieldClass} />}</div>)}
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

    {collectionEntries.map(([key, rawItems]) => { const items = rawItems as any[]; return <section key={key} className="space-y-2"><div className="flex items-center justify-between"><h4 className="text-[10px] font-black uppercase">{LABELS[key] || key}</h4><button type="button" onClick={() => addCollectionItem(key, items)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm</button></div>{items.map((item, index) => <div key={index} className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">{typeof item === 'string' ? <input value={item} onChange={event => updateCollectionItem(key, index, event.target.value)} className={fieldClass} /> : <div className="grid min-w-0 flex-1 gap-2">{Object.entries(item || {}).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([field, value]) => <label key={field} className="text-[9px] font-bold text-slate-500">{LABELS[field] || field}<input value={String(value)} onChange={event => updateCollectionItem(key, index, { ...item, [field]: event.target.value })} className={`${fieldClass} mt-1`} /></label>)}</div>}<button type="button" onClick={() => updateContent(key, items.filter((_, itemIndex) => itemIndex !== index))} className="h-fit rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button></div>)}</section>; })}
  </div>;
}