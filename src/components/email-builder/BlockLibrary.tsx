import React from 'react';
import { 
  Image, 
  Type, 
  Heading, 
  List, 
  ListOrdered, 
  Link, 
  Columns, 
  HelpCircle, 
  Minus, 
  Maximize2, 
  PenTool, 
  Share2, 
  HelpCircle as HighlightIcon
} from 'lucide-react';
import { BlockType } from '../../types/emailBuilder';

interface BlockLibraryProps {
  onAddBlock: (type: BlockType) => void;
}

export default function BlockLibrary({ onAddBlock }: BlockLibraryProps) {
  const libraryItems = [
    {
      type: 'logo' as BlockType,
      label: 'Logo',
      desc: 'Ảnh biểu tượng FermatTech hoặc đối tác',
      icon: Heading
    },
    {
      type: 'heading' as BlockType,
      label: 'Tiêu đề',
      desc: 'Tiêu đề chính phụ H1, H2 hoặc H3',
      icon: Heading
    },
    {
      type: 'paragraph' as BlockType,
      label: 'Đoạn văn',
      desc: 'Đoạn văn bản mô tả, chèn link và biến',
      icon: Type
    },
    {
      type: 'image' as BlockType,
      label: 'Hình ảnh / Banner',
      desc: 'Hình ảnh HTTPS hoặc banner quảng bá',
      icon: Image
    },
    {
      type: 'bullet-list' as BlockType,
      label: 'Danh sách gạch đầu dòng',
      desc: 'Danh sách không thứ tự (ul/li)',
      icon: List
    },
    {
      type: 'number-list' as BlockType,
      label: 'Danh sách số',
      desc: 'Danh sách đếm số thứ tự (ol/li)',
      icon: ListOrdered
    },
    {
      type: 'button' as BlockType,
      label: 'Nút bấm CTA',
      desc: 'Nút bấm kêu gọi hành động nổi bật',
      icon: Link
    },
    {
      type: 'button-group' as BlockType,
      label: 'Hai nút cùng hàng',
      desc: 'Hai nút bấm song song tăng tương tác',
      icon: Columns
    },
    {
      type: 'highlight-box' as BlockType,
      label: 'Hộp thông tin',
      desc: 'Lưu ý, ngày thi, hạn đăng ký nổi bật',
      icon: HighlightIcon
    },
    {
      type: 'divider' as BlockType,
      label: 'Đường phân cách',
      desc: 'Đường nét đứt, nét liền chia bố cục',
      icon: Minus
    },
    {
      type: 'spacer' as BlockType,
      label: 'Khoảng trắng',
      desc: 'Tạo khoảng cách giãn giữa các khối',
      icon: Maximize2
    },
    {
      type: 'signature' as BlockType,
      label: 'Chữ ký',
      desc: 'Chữ ký mặc định FermatTech',
      icon: PenTool
    },
    {
      type: 'social-links' as BlockType,
      label: 'Mạng xã hội',
      desc: 'Liên kết Facebook, Zalo, YouTube',
      icon: Share2
    }
  ];

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200/80 w-80 shrink-0">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
        <h2 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Thư viện Khối nội dung</h2>
        <p className="text-[10px] text-slate-500 mt-1">Bấm vào khối để thêm nhanh vào cuối email.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {libraryItems.map(item => {
          const IconComp = item.icon;
          return (
            <button
              key={item.type}
              onClick={() => onAddBlock(item.type)}
              className="w-full text-left p-3.5 bg-slate-50 hover:bg-blue-50/40 rounded-2xl border border-slate-250/20 hover:border-blue-200 flex gap-3.5 items-center cursor-pointer transition-all active:scale-[0.98] group"
            >
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-blue-650 group-hover:border-blue-100 shadow-sm transition-all">
                <IconComp className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-extrabold text-slate-800 group-hover:text-blue-900 leading-tight">{item.label}</h3>
                <p className="text-[10px] text-slate-500 truncate mt-0.5 leading-tight">{item.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
