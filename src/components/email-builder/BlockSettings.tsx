import React from 'react';
import { AlignLeft, AlignCenter, AlignRight, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { EmailBlock } from '../../types/emailBuilder';

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

  // List block item controls
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

  // Social link helpers
  const handleUpdateSocialLink = (index: number, key: string, val: any) => {
    const links = [...(content.links || [])];
    links[index] = {
      ...links[index],
      [key]: val
    };
    updateContent('links', links);
  };

  return (
    <div className="space-y-5 p-4.5 bg-white overflow-y-auto h-full">
      <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
        <div>
          <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Cấu hình Khối</h3>
          <p className="text-[10px] text-slate-500 mt-0.5 font-semibold uppercase">Loại: {block.type}</p>
        </div>
      </div>

      {/* Common Spacing Style Settings */}
      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/50 space-y-2.5">
        <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Khoảng cách lề (px)</h4>
        <div className="grid grid-cols-2 gap-2">
          {block.type !== 'spacer' && (
            <>
              <div>
                <label className="block text-[9px] text-slate-500 font-bold mb-1">Mép trên (margin-top)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={styles.marginTop ?? 10}
                  onChange={e => updateStyles('marginTop', parseInt(e.target.value) || 0)}
                  className="w-full text-xs rounded-lg border border-slate-200 px-2.5 py-1.5 outline-none bg-white focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[9px] text-slate-500 font-bold mb-1">Mép dưới (margin-bottom)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={styles.marginBottom ?? 10}
                  onChange={e => updateStyles('marginBottom', parseInt(e.target.value) || 0)}
                  className="w-full text-xs rounded-lg border border-slate-200 px-2.5 py-1.5 outline-none bg-white focus:border-blue-500"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* BLOCK-SPECIFIC PROPERTIES */}

      {/* LOGO PROPERTIES */}
      {block.type === 'logo' && (
        <div className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Đường dẫn ảnh HTTPS</label>
            <input
              type="text"
              value={content.url || ''}
              onChange={e => updateContent('url', e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Alt Text (Mô tả ảnh)</label>
            <input
              type="text"
              value={content.alt || ''}
              onChange={e => updateContent('alt', e.target.value)}
              placeholder="Fermat Logo"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Độ rộng ảnh (px)</label>
              <input
                type="number"
                value={content.width || 120}
                onChange={e => updateContent('width', parseInt(e.target.value) || 120)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề</label>
              <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
                {(['left', 'center', 'right'] as const).map(align => (
                  <button
                    key={align}
                    onClick={() => updateContent('align', align)}
                    className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500'}`}
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
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Liên kết khi bấm vào Logo</label>
            <input
              type="text"
              value={content.link || ''}
              onChange={e => updateContent('link', e.target.value)}
              placeholder="https://www.fermat.vn"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {/* HEADING PROPERTIES */}
      {block.type === 'heading' && (
        <div className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Nội dung tiêu đề</label>
            <input
              type="text"
              value={content.text || ''}
              onChange={e => updateContent('text', e.target.value)}
              placeholder="Nhập tiêu đề..."
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Thẻ tiêu đề</label>
              <select
                value={content.level || 'h2'}
                onChange={e => updateContent('level', e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white"
              >
                <option value="h1">H1 (Lớn nhất)</option>
                <option value="h2">H2 (Vừa)</option>
                <option value="h3">H3 (Nhỏ)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Cỡ chữ (px)</label>
              <input
                type="number"
                value={content.fontSize || 18}
                onChange={e => updateContent('fontSize', parseInt(e.target.value) || 18)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu chữ</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={content.color || '#0f3a72'}
                  onChange={e => updateContent('color', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={content.color || '#0f3a72'}
                  onChange={e => updateContent('color', e.target.value)}
                  className="flex-1 text-xs rounded-xl border border-slate-200 px-2 outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Định dạng</label>
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-650 font-bold select-none">
                  <input
                    type="checkbox"
                    checked={content.bold !== false}
                    onChange={e => updateContent('bold', e.target.checked)}
                    className="w-4.5 h-4.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                  In đậm
                </label>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề</label>
            <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500'}`}
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

      {/* PARAGRAPH PROPERTIES */}
      {block.type === 'paragraph' && (
        <div className="space-y-3.5">
          <p className="text-[11px] text-slate-500 leading-normal italic bg-slate-50 p-3 rounded-xl border border-slate-250/20">
            * Nội dung văn bản của khối Đoạn văn được chỉnh sửa trực tiếp trên vùng Email Canvas ở giữa, sử dụng thanh công cụ soạn thảo nổi bật.
          </p>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề mặc định</label>
            <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500'}`}
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
        <div className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Đường dẫn ảnh HTTPS</label>
            <input
              type="text"
              value={content.url || ''}
              onChange={e => updateContent('url', e.target.value)}
              placeholder="https://example.com/banner.png"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Alt Text (Mô tả ảnh)</label>
            <input
              type="text"
              value={content.alt || ''}
              onChange={e => updateContent('alt', e.target.value)}
              placeholder="Banner cuộc thi AYSBC"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Độ rộng tối đa (px)</label>
              <input
                type="number"
                value={content.width || 600}
                onChange={e => updateContent('width', parseInt(e.target.value) || 600)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Bo góc khung ảnh (px)</label>
              <input
                type="number"
                value={content.borderRadius || 0}
                onChange={e => updateContent('borderRadius', parseInt(e.target.value) || 0)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề ảnh</label>
            <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500'}`}
                >
                  {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                  {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                  {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Liên kết khi bấm vào ảnh</label>
            <input
              type="text"
              value={content.link || ''}
              onChange={e => updateContent('link', e.target.value)}
              placeholder="https://www.fermat.vn"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {/* LIST PROPERTIES (BULLET & NUMBER) */}
      {(block.type === 'bullet-list' || block.type === 'number-list') && (
        <div className="space-y-3.5">
          <div className="flex justify-between items-center">
            <label className="block text-[10px] font-bold text-slate-500">Danh sách dòng</label>
            <button
              onClick={handleAddListItem}
              className="flex items-center gap-1 text-[10px] font-bold text-blue-650 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/70 border border-blue-200 px-2 py-1 rounded-lg cursor-pointer transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Thêm dòng
            </button>
          </div>
          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
            {(content.items || []).map((item: string, index: number) => (
              <div key={index} className="flex items-center gap-1.5 p-2 bg-slate-50 border border-slate-250/20 rounded-xl">
                <input
                  type="text"
                  value={item}
                  onChange={e => handleUpdateListItem(index, e.target.value)}
                  className="flex-1 text-xs rounded-lg border border-slate-200 px-2.5 py-1.5 outline-none bg-white focus:border-blue-500"
                />
                <button
                  disabled={index === 0}
                  onClick={() => handleMoveListItem(index, 'up')}
                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded disabled:opacity-30 cursor-pointer"
                  title="Di chuyển lên"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={index === (content.items || []).length - 1}
                  onClick={() => handleMoveListItem(index, 'down')}
                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded disabled:opacity-30 cursor-pointer"
                  title="Di chuyển xuống"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleRemoveListItem(index)}
                  className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-100 rounded cursor-pointer"
                  title="Xóa dòng"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA BUTTON PROPERTIES */}
      {block.type === 'button' && (
        <div className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Nội dung chữ trên nút</label>
            <input
              type="text"
              value={content.text || ''}
              onChange={e => updateContent('text', e.target.value)}
              placeholder="Đăng ký tham gia cho con"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Đường dẫn liên kết (URL)</label>
            <input
              type="text"
              value={content.link || ''}
              onChange={e => updateContent('link', e.target.value)}
              placeholder="https://example.com/register"
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu nền nút</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={content.bg || '#1473d1'}
                  onChange={e => updateContent('bg', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={content.bg || '#1473d1'}
                  onChange={e => updateContent('bg', e.target.value)}
                  className="flex-1 text-xs rounded-xl border border-slate-200 px-2 outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu chữ trên nút</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={content.color || '#ffffff'}
                  onChange={e => updateContent('color', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={content.color || '#ffffff'}
                  onChange={e => updateContent('color', e.target.value)}
                  className="flex-1 text-xs rounded-xl border border-slate-200 px-2 outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Bo góc nút (px)</label>
              <input
                type="number"
                value={content.radius ?? 8}
                onChange={e => updateContent('radius', parseInt(e.target.value) || 0)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Chiều rộng nút</label>
              <select
                value={content.width || 'auto'}
                onChange={e => updateContent('width', e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white"
              >
                <option value="auto">Tự động vừa chữ</option>
                <option value="full">Đầy hàng 100%</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề nút</label>
            <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500'}`}
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

      {/* BUTTON GROUP PROPERTIES */}
      {block.type === 'button-group' && (
        <div className="space-y-4">
          <div>
            <h4 className="text-[10px] font-extrabold text-blue-650 uppercase border-b border-slate-100 pb-1 mb-2">Cấu hình chung</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Khoảng cách 2 nút</label>
                <input
                  type="number"
                  value={content.gap ?? 15}
                  onChange={e => updateContent('gap', parseInt(e.target.value) || 0)}
                  className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề</label>
                <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
                  {(['left', 'center', 'right'] as const).map(align => (
                    <button
                      key={align}
                      onClick={() => updateContent('align', align)}
                      className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500'}`}
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

          <div>
            <h4 className="text-[10px] font-extrabold text-slate-700 uppercase border-b border-slate-100 pb-1 mb-2">Nút bên trái (Nút 1)</h4>
            <div className="space-y-2.5">
              <div>
                <input
                  type="text"
                  placeholder="Chữ nút 1"
                  value={content.btn1?.text || ''}
                  onChange={e => updateContent('btn1', { ...content.btn1, text: e.target.value })}
                  className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="URL liên kết 1"
                  value={content.btn1?.link || ''}
                  onChange={e => updateContent('btn1', { ...content.btn1, link: e.target.value })}
                  className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="color"
                  value={content.btn1?.bg || '#1473d1'}
                  onChange={e => updateContent('btn1', { ...content.btn1, bg: e.target.value })}
                  className="w-full h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                  title="Màu nền nút 1"
                />
                <input
                  type="color"
                  value={content.btn1?.color || '#ffffff'}
                  onChange={e => updateContent('btn1', { ...content.btn1, color: e.target.value })}
                  className="w-full h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                  title="Màu chữ nút 1"
                />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-extrabold text-slate-700 uppercase border-b border-slate-100 pb-1 mb-2">Nút bên phải (Nút 2)</h4>
            <div className="space-y-2.5">
              <div>
                <input
                  type="text"
                  placeholder="Chữ nút 2"
                  value={content.btn2?.text || ''}
                  onChange={e => updateContent('btn2', { ...content.btn2, text: e.target.value })}
                  className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="URL liên kết 2"
                  value={content.btn2?.link || ''}
                  onChange={e => updateContent('btn2', { ...content.btn2, link: e.target.value })}
                  className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="color"
                  value={content.btn2?.bg || '#f1f5f9'}
                  onChange={e => updateContent('btn2', { ...content.btn2, bg: e.target.value })}
                  className="w-full h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                  title="Màu nền nút 2"
                />
                <input
                  type="color"
                  value={content.btn2?.color || '#0f3a72'}
                  onChange={e => updateContent('btn2', { ...content.btn2, color: e.target.value })}
                  className="w-full h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                  title="Màu chữ nút 2"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HIGHLIGHT BOX PROPERTIES */}
      {block.type === 'highlight-box' && (
        <div className="space-y-3.5">
          <p className="text-[11px] text-slate-500 leading-normal italic bg-slate-50 p-3 rounded-xl border border-slate-250/20">
            * Chỉnh sửa chữ và biến cá nhân hóa trực tiếp trên vùng Email Canvas ở giữa.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu nền hộp</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={content.bg || '#eef6ff'}
                  onChange={e => updateContent('bg', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={content.bg || '#eef6ff'}
                  onChange={e => updateContent('bg', e.target.value)}
                  className="flex-1 text-xs rounded-xl border border-slate-200 px-2 outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu viền trái</label>
              <div className="flex gap-1.5">
                <input
                  type="color"
                  value={content.borderColor || '#1473d1'}
                  onChange={e => updateContent('borderColor', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={content.borderColor || '#1473d1'}
                  onChange={e => updateContent('borderColor', e.target.value)}
                  className="flex-1 text-xs rounded-xl border border-slate-200 px-2 outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Khoảng cách đệm bên trong (px)</label>
            <input
              type="number"
              value={content.padding ?? 16}
              onChange={e => updateContent('padding', parseInt(e.target.value) || 0)}
              className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {/* DIVIDER PROPERTIES */}
      {block.type === 'divider' && (
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Độ dày nét (px)</label>
              <input
                type="number"
                min="1"
                max="10"
                value={styles.thickness ?? 1}
                onChange={e => updateStyles('thickness', parseInt(e.target.value) || 1)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">Kiểu nét</label>
              <select
                value={styles.borderStyle || 'solid'}
                onChange={e => updateStyles('borderStyle', e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 bg-white"
              >
                <option value="solid">Nét liền (Solid)</option>
                <option value="dashed">Nét đứt to (Dashed)</option>
                <option value="dotted">Nét đứt chấm (Dotted)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Màu đường kẻ</label>
            <div className="flex gap-1.5">
              <input
                type="color"
                value={styles.color || '#e2e8f0'}
                onChange={e => updateStyles('color', e.target.value)}
                className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 p-0.5 bg-white"
              />
              <input
                type="text"
                value={styles.color || '#e2e8f0'}
                onChange={e => updateStyles('color', e.target.value)}
                className="flex-1 text-xs rounded-xl border border-slate-200 px-2 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* SPACER PROPERTIES */}
      {block.type === 'spacer' && (
        <div>
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
              className="w-16 text-xs rounded-xl border border-slate-200 px-2.5 py-1.5 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {/* SIGNATURE PROPERTIES */}
      {block.type === 'signature' && (
        <div className="space-y-3.5">
          <p className="text-[11px] text-slate-500 leading-normal italic bg-slate-50 p-3 rounded-xl border border-slate-250/20">
            * Chữ ký liên hệ được chỉnh sửa trực tiếp trên vùng Email Canvas ở giữa.
          </p>
        </div>
      )}

      {/* SOCIAL LINKS PROPERTIES */}
      {block.type === 'social-links' && (
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Căn lề</label>
            <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-0.5">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateContent('align', align)}
                  className={`flex-1 flex justify-center py-1.5 rounded-lg cursor-pointer ${content.align === align ? 'bg-white text-blue-650 shadow-sm font-bold' : 'text-slate-500'}`}
                >
                  {align === 'left' && <AlignLeft className="w-4.5 h-4.5" />}
                  {align === 'center' && <AlignCenter className="w-4.5 h-4.5" />}
                  {align === 'right' && <AlignRight className="w-4.5 h-4.5" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-2">Danh sách mạng xã hội</label>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {(content.links || []).map((link: any, index: number) => (
                <div key={index} className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{link.label}</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-500 select-none">
                      <input
                        type="checkbox"
                        checked={link.visible !== false}
                        onChange={e => handleUpdateSocialLink(index, 'visible', e.target.checked)}
                        className="w-3.5 h-3.5 text-blue-650 border-slate-300 rounded focus:ring-blue-500"
                      />
                      Hiển thị
                    </label>
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="URL liên kết mạng xã hội"
                      value={link.url || ''}
                      onChange={e => handleUpdateSocialLink(index, 'url', e.target.value)}
                      className="w-full text-xs rounded-lg border border-slate-200 px-2.5 py-1.5 outline-none bg-white focus:border-blue-500"
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
