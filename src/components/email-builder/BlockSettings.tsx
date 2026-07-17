import React from 'react';
import { AlignLeft, AlignCenter, AlignRight, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { EmailBlock } from '../../types/emailBuilder';
import { getBlockDefinition } from '../../data/emailBlockRegistry';
import ColorField from './ColorField';

interface BlockSettingsProps {
  block: EmailBlock;
  onUpdateBlockContent: (content: Record<string, any>) => void;
  onUpdateBlockStyles: (styles: Record<string, any>) => void;
}

export default function BlockSettings({
  block,
  onUpdateBlockContent,
  onUpdateBlockStyles
}: BlockSettingsProps) {
  const content = block.content;
  const styles = block.styles;
  const isSchemaBlock = ['section','columns','image-text','data-table','testimonial','callout','gallery','video','feature-list','product-card','product-grid','pricing-table','header','footer','merge-tag','custom-html'].includes(block.type);
  const definition = getBlockDefinition(block.type);

  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Vui lòng chọn tệp hình ảnh hợp lệ.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setUploadError('Tệp quá lớn. Vui lòng chọn tệp nhỏ hơn 3MB.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;

        try {
          const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              filename: file.name,
              base64: base64
            })
          });

          const data = await response.json();
          if (data.success && data.url) {
            const absoluteUrl = `${window.location.origin}${data.url}`;
            updateContent('url', absoluteUrl);
          } else {
            updateContent('url', base64);
            setUploadError(data.error || 'Không upload được, đã dùng ảnh nhúng để copy sang Gmail.');
          }
        } catch (error: any) {
          updateContent('url', base64);
          setUploadError(error?.message ? `Không upload được, đã dùng ảnh nhúng: ${error.message}` : 'Không upload được, đã dùng ảnh nhúng để copy sang Gmail.');
        } finally {
          setIsUploading(false);
        }
      };
      
      reader.onerror = () => {
        setUploadError('Không thể đọc dữ liệu tệp.');
        setIsUploading(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError(err.message || 'Lỗi kết nối máy chủ.');
      setIsUploading(false);
    }
  };

  const handlePasteEvent = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            await handleFileUpload(file);
            break;
          }
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileUpload(file);
    }
  };

  const ImageUploader = () => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    return (
      <div className="space-y-2.5">
        <label className="block text-[10px] font-bold text-slate-500 mb-1">Tải ảnh hoặc Dán ảnh (Ctrl+V)</label>
        
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPaste={handlePasteEvent}
          className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/10 rounded-2xl p-4 text-center cursor-pointer transition-all relative group flex flex-col items-center justify-center min-h-[100px] outline-none"
          tabIndex={0}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-1">
              <div className="w-6 h-6 border-2 border-blue-650 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-[10px] text-slate-400 font-bold">Đang tải lên...</span>
            </div>
          ) : (
            <label className="cursor-pointer w-full h-full block">
              <input
                type="file"
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                className="hidden"
              />
              <div className="space-y-1.5 pointer-events-none">
                <div className="text-xs text-slate-650 font-black">
                  Kéo thả, Click chọn hoặc <span className="text-blue-600 underline">Paste (Ctrl+V)</span> ảnh
                </div>
                <div className="text-[9px] text-slate-400">Hỗ trợ JPG, PNG, GIF, tối đa 3MB</div>
              </div>
            </label>
          )}
        </div>

        {uploadError && (
          <div className="text-[9px] text-rose-500 bg-rose-50 border border-rose-100 p-2 rounded-xl font-bold">
            {uploadError}
          </div>
        )}

        {isLocalhost && content.url && content.url.includes('localhost') && (
          <div className="text-[9px] text-amber-600 bg-amber-50 border border-amber-100 p-2.5 rounded-xl leading-relaxed font-semibold">
            <strong>Lưu ý local</strong>: Khi bấm Copy nội dung, ảnh local sẽ được nhúng vào clipboard để dán Gmail. Nếu gửi bằng link ảnh trực tiếp, hãy dùng URL public HTTPS.
          </div>
        )}
      </div>
    );
  };

  const updateContent = (key: string, value: any) => {
    onUpdateBlockContent({
      ...content,
      [key]: value
    });
  };

  const updateStyles = (key: string, value: any) => {
    onUpdateBlockStyles({
      ...styles,
      [key]: value
    });
  };

  const handleAddListItem = () => {
    const items = content.items || [];
    updateContent('items', [...items, 'Mục mới']);
  };

  const handleUpdateListItem = (index: number, val: string) => {
    const items = [...(content.items || [])];
    items[index] = val;
    updateContent('items', items);
  };

  const handleRemoveListItem = (index: number) => {
    const items = [...(content.items || [])];
    items.splice(index, 1);
    updateContent('items', items);
  };

  const handleMoveListItem = (index: number, direction: 'up' | 'down') => {
    const items = [...(content.items || [])];
    if (direction === 'up' && index > 0) {
      const temp = items[index];
      items[index] = items[index - 1];
      items[index - 1] = temp;
    } else if (direction === 'down' && index < items.length - 1) {
      const temp = items[index];
      items[index] = items[index + 1];
      items[index + 1] = temp;
    }
    updateContent('items', items);
  };


  const groupButtons = () => content.buttons || [content.btn1, content.btn2].filter(Boolean);
  const updateGroupButton = (index: number, patch: Record<string, any>) => { const buttons = groupButtons(); buttons[index] = { ...buttons[index], ...patch }; onUpdateBlockContent({ ...content, buttons }); };

  const handleUpdateSocialLink = (index: number, key: string, val: any) => {
    const links = [...(content.links || [])];
    links[index] = {
      ...links[index],
      [key]: val
    };
    updateContent('links', links);
  };

  return (
    <div className="space-y-5 p-5 bg-white overflow-y-auto h-full select-text">
      
      <div className="border-b border-slate-100 pb-3">
        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Thuộc tính Khối</h3>
        <p className="text-[10px] text-slate-400 font-extrabold mt-1">Phân loại: <span className="text-blue-650 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 uppercase">{block.type}</span></p>
      </div>

      {isSchemaBlock && (
        <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3.5">
          <div><label className="mb-1 block text-[10px] font-bold text-slate-600">Bi?n th? giao di?n</label><select value={content.variant || definition.variants[0]?.value} onChange={e => updateContent('variant', e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500">{definition.variants.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</select></div>
          {Object.entries(content).filter(([key, value]) => key !== 'variant' && (typeof value === 'string' || typeof value === 'number')).map(([key, value]) => <div key={key}><label className="mb-1 block text-[10px] font-bold capitalize text-slate-600">{key}</label>{key === 'html' ? <textarea value={String(value)} onChange={e => updateContent(key, e.target.value)} spellCheck={false} className="min-h-40 w-full rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] text-emerald-200 outline-none focus:border-blue-500" /> : <input type={key.toLowerCase().includes('url') || key === 'link' ? 'url' : 'text'} value={String(value)} onChange={e => updateContent(key, e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500" />}</div>)}
          {block.type === 'custom-html' && <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[10px] leading-relaxed text-amber-800">Email client h\u1ed7 tr\u1ee3 CSS h\u1ea1n ch\u1ebf. \u01afu ti\u00ean table v\u00e0 style inline; script, event handler v\u00e0 iframe s\u1ebd t\u1ef1 \u0111\u1ed9ng b\u1ecb lo\u1ea1i b\u1ecf.</p>}
        </div>
      )}

      {/* Common margins */}
      {block.type !== 'spacer' && (
        <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50 space-y-2.5">
          <h4 className="text-[10px] font-black text-slate-650 uppercase tracking-wider">Mép khoảng cách lề (px)</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[9px] text-slate-500 font-bold mb-1">Căn lề trên</label>
              <input
                type="number"
                min="0"
                max="100"
                value={styles.marginTop ?? 10}
                onChange={e => updateStyles('marginTop', parseInt(e.target.value) || 0)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none bg-white focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[9px] text-slate-500 font-bold mb-1">Căn lề dưới</label>
              <input
                type="number"
                min="0"
                max="100"
                value={styles.marginBottom ?? 10}
                onChange={e => updateStyles('marginBottom', parseInt(e.target.value) || 0)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none bg-white focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* LOGO PROPERTIES */}
      {block.type === 'logo' && (
        <div className="space-y-4">
          <ImageUploader />
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">URL ảnh Logo</label>
            <input
              type="text"
              value={content.url || ''}
              onChange={e => updateContent('url', e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Alt Text (Mô tả ảnh)</label>
            <input
              type="text"
              value={content.alt || ''}
              onChange={e => updateContent('alt', e.target.value)}
              placeholder="Logo FermatTech"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Chiều rộng Logo (px)</label>
              <input
                type="number"
                value={content.width || 120}
                onChange={e => updateContent('width', parseInt(e.target.value) || 120)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề</label>
              <div className="flex bg-slate-100 border border-slate-200/80 rounded-xl p-0.5 shadow-sm">
                {(['left', 'center', 'right'] as const).map(align => (
                  <button
                    key={align}
                    onClick={() => updateContent('align', align)}
                    className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer transition-all ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                    {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                    {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Đường dẫn liên kết khi nhấp</label>
            <input
              type="text"
              value={content.link || ''}
              onChange={e => updateContent('link', e.target.value)}
              placeholder="https://www.fermat.vn"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
        </div>
      )}

      {/* HEADING PROPERTIES */}
      {block.type === 'heading' && (
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Nội dung Tiêu đề</label>
            <input
              type="text"
              value={content.text || ''}
              onChange={e => updateContent('text', e.target.value)}
              placeholder="Nhập tiêu đề..."
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Thẻ cấu trúc</label>
              <select
                value={content.level || 'h2'}
                onChange={e => updateContent('level', e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white shadow-sm"
              >
                <option value="h1">H1 (Tiêu đề chính)</option>
                <option value="h2">H2 (Tiêu đề phụ)</option>
                <option value="h3">H3 (Mục nhỏ)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Cỡ chữ (px)</label>
              <input
                type="number"
                value={content.fontSize || 18}
                onChange={e => updateContent('fontSize', parseInt(e.target.value) || 18)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
              />
            </div>
          </div>
          
          <ColorField
            label="Màu chữ tiêu đề"
            value={content.color || '#0f3a72'}
            onChange={color => updateContent('color', color)}
          />

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Định dạng nét</label>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-650 font-bold select-none pt-1.5">
                <input
                  type="checkbox"
                  checked={content.bold !== false}
                  onChange={e => updateContent('bold', e.target.checked)}
                  className="w-4.5 h-4.5 text-blue-600 border-slate-350 rounded focus:ring-blue-500"
                />
                In đậm (Bold)
              </label>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề chữ</label>
              <div className="flex bg-slate-100 border border-slate-200/80 rounded-xl p-0.5 shadow-sm">
                {(['left', 'center', 'right'] as const).map(align => (
                  <button
                    key={align}
                    onClick={() => updateContent('align', align)}
                    className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer transition-all ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                    {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                    {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PARAGRAPH PROPERTIES */}
      {block.type === 'paragraph' && (
        <div className="space-y-4">
          <p className="text-[11px] text-slate-450 leading-normal italic bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
            * Nhấp đúp vào khối Đoạn văn trên canvas để sửa nội dung và chèn biến.
          </p>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề chữ mặc định</label>
            <div className="flex bg-slate-100 border border-slate-200/80 rounded-xl p-0.5 shadow-sm">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer transition-all ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                  {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                  {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* IMAGE PROPERTIES */}
      {block.type === 'image' && (
        <div className="space-y-4">
          <ImageUploader />
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Đường dẫn ảnh HTTPS</label>
            <input
              type="text"
              value={content.url || ''}
              onChange={e => updateContent('url', e.target.value)}
              placeholder="https://example.com/banner.png"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Alt Text (Mô tả ảnh)</label>
            <input
              type="text"
              value={content.alt || ''}
              onChange={e => updateContent('alt', e.target.value)}
              placeholder="Banner tuyển sinh AYSBC"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Rộng tối đa (px)</label>
              <input
                type="number"
                value={content.width || 600}
                onChange={e => updateContent('width', parseInt(e.target.value) || 600)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Bo góc ảnh (px)</label>
              <input
                type="number"
                value={content.borderRadius || 0}
                onChange={e => updateContent('borderRadius', parseInt(e.target.value) || 0)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề ngang</label>
              <div className="flex bg-slate-100 border border-slate-200/80 rounded-xl p-0.5 shadow-sm">
                {(['left', 'center', 'right'] as const).map(align => (
                  <button
                    key={align}
                    onClick={() => updateContent('align', align)}
                    className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer transition-all ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                    {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                    {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Liên kết khi bấm vào hình</label>
            <input
              type="text"
              value={content.link || ''}
              onChange={e => updateContent('link', e.target.value)}
              placeholder="https://www.fermat.vn"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
        </div>
      )}

      {/* LIST PROPERTIES */}
      {(block.type === 'bullet-list' || block.type === 'number-list') && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <label className="block text-[10px] font-bold text-slate-550">Danh sách dòng</label>
            <button
              onClick={handleAddListItem}
              className="flex items-center gap-1 text-[10px] font-bold text-blue-650 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200/80 px-2 py-1 rounded-lg cursor-pointer transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Thêm dòng
            </button>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {(content.items || []).map((item: string, index: number) => (
              <div key={index} className="flex items-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <input
                  type="text"
                  value={item}
                  onChange={e => handleUpdateListItem(index, e.target.value)}
                  className="flex-1 text-xs rounded-lg border border-slate-200 px-2 py-1.5 outline-none bg-white focus:border-blue-500 shadow-sm"
                />
                <div className="flex shrink-0">
                  <button
                    disabled={index === 0}
                    onClick={() => handleMoveListItem(index, 'up')}
                    className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={index === (content.items || []).length - 1}
                    onClick={() => handleMoveListItem(index, 'down')}
                    className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleRemoveListItem(index)}
                    className="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA BUTTON PROPERTIES */}
      {block.type === 'button' && (
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Chữ hiển thị trên nút</label>
            <input
              type="text"
              value={content.text || ''}
              onChange={e => updateContent('text', e.target.value)}
              placeholder="Đăng ký ngay"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Liên kết nút (URL)</label>
            <input
              type="text"
              value={content.link || ''}
              onChange={e => updateContent('link', e.target.value)}
              placeholder="https://example.com"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          
          <ColorField
            label="Màu nền nút"
            value={content.bg || '#1473d1'}
            onChange={color => updateContent('bg', color)}
          />

          <ColorField
            label="Màu chữ trên nút"
            value={content.color || '#ffffff'}
            onChange={color => updateContent('color', color)}
          />

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Bo góc nút (px)</label>
              <input
                type="number"
                value={content.radius ?? 8}
                onChange={e => updateContent('radius', parseInt(e.target.value) || 0)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Độ rộng nút</label>
              <select
                value={content.width || 'auto'}
                onChange={e => updateContent('width', e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white shadow-sm"
              >
                <option value="auto">Vừa khít chữ</option>
                <option value="full">100% hàng ngang</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề nút</label>
            <div className="flex bg-slate-100 border border-slate-200/80 rounded-xl p-0.5 shadow-sm">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer transition-all ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                  {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                  {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ACTION BUTTON GROUP PROPERTIES */}
      {block.type === 'button-group' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200/50 bg-slate-50 p-3.5">
            <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-650">Nh\u00f3m n\u00fat h\u00e0nh \u0111\u1ed9ng</h4>
            <div className="mt-3 grid grid-cols-2 gap-3"><div><label className="mb-1 block text-[9px] font-bold text-slate-500">S\u1ed1 n\u00fat</label><select value={groupButtons().length} onChange={e => { const count = Number(e.target.value); const buttons = groupButtons(); while (buttons.length < count) buttons.push({ text: 'H\u00e0nh \u0111\u1ed9ng m\u1edbi', link: 'https://www.fermat.vn', bg: '#0F3A72', color: '#ffffff', radius: 8 }); onUpdateBlockContent({ ...content, buttons: buttons.slice(0, count) }); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500"><option value="2">2 n\u00fat</option><option value="3">3 n?t</option><option value="4">4 n?t</option></select></div><div><label className="mb-1 block text-[9px] font-bold text-slate-500">Kho\u1ea3ng c\u00e1ch (px)</label><input type="number" value={content.gap ?? 12} onChange={e => updateContent('gap', parseInt(e.target.value) || 0)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500" /></div></div>
          </div>
          {groupButtons().map((button: any, index: number) => <div key={index} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3"><h4 className="text-[10px] font-black uppercase text-slate-700">N\u00fat h\u00e0nh \u0111\u1ed9ng {index + 1}</h4><input value={button.text || ''} onChange={e => updateGroupButton(index, { text: e.target.value })} placeholder="Nh?n n?t" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500" /><input value={button.link || ''} onChange={e => updateGroupButton(index, { link: e.target.value })} placeholder="https://..." className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500" /><div className="grid grid-cols-2 gap-2"><ColorField label="M\u00e0u n\u1ec1n" value={button.bg || '#0F3A72'} onChange={color => updateGroupButton(index, { bg: color })} /><ColorField label="M\u00e0u ch\u1eef" value={button.color || '#ffffff'} onChange={color => updateGroupButton(index, { color })} /></div></div>)}
        </div>
      )}

      {/* HIGHLIGHT BOX PROPERTIES */}
      {block.type === 'highlight-box' && (
        <div className="space-y-4">
          <p className="text-[11px] text-slate-450 leading-normal italic bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
            * Sửa nội dung hộp và chèn biến trực quan trên canvas ở giữa.
          </p>
          
          <ColorField
            label="Màu nền hộp thông tin"
            value={content.bg || '#eef6ff'}
            onChange={color => updateContent('bg', color)}
          />

          <ColorField
            label="Màu đường viền trái"
            value={content.borderColor || '#1473d1'}
            onChange={color => updateContent('borderColor', color)}
          />

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Khoảng cách đệm bên trong (px)</label>
            <input
              type="number"
              value={content.padding ?? 16}
              onChange={e => updateContent('padding', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
        </div>
      )}

      {/* DIVIDER PROPERTIES */}
      {block.type === 'divider' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Độ dày nét kẻ (px)</label>
              <input
                type="number"
                min="1"
                max="10"
                value={styles.thickness ?? 1}
                onChange={e => updateStyles('thickness', parseInt(e.target.value) || 1)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Kiểu nét</label>
              <select
                value={styles.borderStyle || 'solid'}
                onChange={e => updateStyles('borderStyle', e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white shadow-sm"
              >
                <option value="solid">Nét liền (Solid)</option>
                <option value="dashed">Nét đứt rời (Dashed)</option>
                <option value="dotted">Nét chấm tròn (Dotted)</option>
              </select>
            </div>
          </div>
          
          <ColorField
            label="Màu nét đường kẻ"
            value={styles.color || '#e2e8f0'}
            onChange={color => updateStyles('color', color)}
          />
        </div>
      )}

      {/* SPACER PROPERTIES */}
      {block.type === 'spacer' && (
        <div className="space-y-3">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">Chiều cao khoảng trống (px)</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="5"
              max="150"
              value={styles.height ?? 20}
              onChange={e => updateStyles('height', parseInt(e.target.value) || 5)}
              className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
            />
            <input
              type="number"
              min="5"
              max="150"
              value={styles.height ?? 20}
              onChange={e => updateStyles('height', parseInt(e.target.value) || 5)}
              className="w-16 text-xs rounded-xl border border-slate-200 px-2.5 py-1.5 outline-none focus:border-blue-500 shadow-sm bg-white"
            />
          </div>
        </div>
      )}

      {/* SOCIAL LINKS PROPERTIES */}
      {block.type === 'social-links' && (
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề ngang</label>
            <div className="flex bg-slate-100 border border-slate-200/80 rounded-xl p-0.5 shadow-sm">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer transition-all ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                  {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                  {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-2">Các tài khoản liên kết</label>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {(content.links || []).map((link: any, index: number) => (
                <div key={index} className="bg-slate-50 border border-slate-200 p-3 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{link.label}</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-500 select-none">
                      <input
                        type="checkbox"
                        checked={link.visible !== false}
                        onChange={e => handleUpdateSocialLink(index, 'visible', e.target.checked)}
                        className="w-3.5 h-3.5 text-blue-650 border-slate-350 rounded focus:ring-blue-500"
                      />
                      Hiển thị
                    </label>
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="URL của bạn..."
                      value={link.url || ''}
                      onChange={e => handleUpdateSocialLink(index, 'url', e.target.value)}
                      className="w-full text-xs rounded-xl border border-slate-200 px-2.5 py-1.5 outline-none bg-white focus:border-blue-500 shadow-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
