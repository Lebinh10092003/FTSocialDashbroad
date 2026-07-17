import React from 'react';
import { 
  Image, 
  Type, 
  Heading, 
  List, 
  ListOrdered, 
  Link2, 
  Columns, 
  AlertCircle, 
  Minus, 
  Move, 
  PenTool, 
  Share2, 
  Tag
} from 'lucide-react';
import { BlockType } from '../../types/emailBuilder';

interface BlockLibraryProps {
  onAddBlock: (type: BlockType) => void;
}

export default function BlockLibrary({ onAddBlock }: BlockLibraryProps) {
  
  const categories = [
    {
      title: 'Cơ bản & Chữ',
      color: 'from-blue-500 to-indigo-650',
      items: [
        {
          type: 'heading' as BlockType,
          label: 'Tiêu đề chính phụ',
          desc: 'Thẻ H1, H2, H3 với kích thước và màu sắc tự chọn',
          icon: Heading,
          iconColor: 'text-indigo-600 bg-indigo-50 border-indigo-100'
        },
        {
          type: 'paragraph' as BlockType,
          label: 'Đoạn văn bản',
          desc: 'Đoạn mô tả, hỗ trợ định dạng in đậm, nghiêng, chèn biến',
          icon: Type,
          iconColor: 'text-blue-600 bg-blue-50 border-blue-100'
        },
        {
          type: 'bullet-list' as BlockType,
          label: 'Danh sách gạch đầu dòng',
          desc: 'Danh sách các mục liệt kê không đánh số',
          icon: List,
          iconColor: 'text-violet-600 bg-violet-50 border-violet-100'
        },
        {
          type: 'number-list' as BlockType,
          label: 'Danh sách số',
          desc: 'Danh sách đếm số thứ tự các bước',
          icon: ListOrdered,
          iconColor: 'text-purple-600 bg-purple-50 border-purple-100'
        }
      ]
    },
    {
      title: 'Hình ảnh & Thương hiệu',
      color: 'from-emerald-500 to-teal-650',
      items: [
        {
          type: 'logo' as BlockType,
          label: 'Logo đại diện',
          desc: 'Logo của Fermat hoặc đối tác đặt ở đầu email',
          icon: PenTool,
          iconColor: 'text-emerald-600 bg-emerald-50 border-emerald-100'
        },
        {
          type: 'image' as BlockType,
          label: 'Ảnh / Banner quảng cáo',
          desc: 'Hình ảnh HTTPS hoặc banner nổi bật giữa email',
          icon: Image,
          iconColor: 'text-teal-600 bg-teal-50 border-teal-100'
        }
      ]
    },
    {
      title: 'Nút hành động & Bố cục',
      color: 'from-amber-500 to-orange-650',
      items: [
        {
          type: 'button' as BlockType,
          label: 'Nút bấm kêu gọi (CTA)',
          desc: 'Nút bấm thu hút lượt click đăng ký, xem chi tiết',
          icon: Link2,
          iconColor: 'text-amber-600 bg-amber-50 border-amber-100'
        },
        {
          type: 'button-group' as BlockType,
          label: 'Hai nút cùng hàng',
          desc: 'Bố cục 2 nút bấm song song cho nhiều lựa chọn',
          icon: Columns,
          iconColor: 'text-orange-600 bg-orange-50 border-orange-100'
        },
        {
          type: 'divider' as BlockType,
          label: 'Đường phân cách',
          desc: 'Đường kẻ mỏng chia bố cục rõ ràng',
          icon: Minus,
          iconColor: 'text-slate-500 bg-slate-550/10 border-slate-200'
        },
        {
          type: 'spacer' as BlockType,
          label: 'Khoảng trắng giãn cách',
          desc: 'Tạo khoảng thở dọc giữa các phần nội dung',
          icon: Move,
          iconColor: 'text-slate-500 bg-slate-550/10 border-slate-200'
        }
      ]
    },
    {
      title: 'Thông tin liên hệ & Hộp chú thích',
      color: 'from-rose-500 to-pink-650',
      items: [
        {
          type: 'highlight-box' as BlockType,
          label: 'Hộp thông tin nổi bật',
          desc: 'Hộp nền màu có viền trái để ghi ngày thi, ghi chú',
          icon: AlertCircle,
          iconColor: 'text-pink-600 bg-pink-50 border-pink-100'
        },
        {
          type: 'signature' as BlockType,
          label: 'Chữ ký Ban tổ chức',
          desc: 'Thông tin liên hệ, hotline, email FermatTech',
          icon: PenTool,
          iconColor: 'text-rose-600 bg-rose-50 border-rose-100'
        },
        {
          type: 'social-links' as BlockType,
          label: 'Mạng xã hội',
          desc: 'Các nút liên kết Facebook, Zalo, YouTube, Website',
          icon: Share2,
          iconColor: 'text-red-600 bg-red-50 border-red-100'
        }
      ]
    }
  ];

  return (
    <div className="flex h-full w-[320px] shrink-0 select-text flex-col border-r border-slate-200/80 bg-white">
      
      {/* Title Header */}
      <div className="border-b border-slate-200 bg-white p-4 shadow-[0_1px_5px_rgba(0,0,0,0.005)]">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-800">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
          Nội dung
        </h2>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-450">Chọn khối để thêm vào canvas, sau đó chỉnh chi tiết ở bảng bên phải.</p>
      </div>

      {/* Grouped scrollable area */}
      <div className="flex-1 space-y-4 overflow-y-auto p-3.5">
        {categories.map((cat, idx) => (
          <div key={idx} className="space-y-2">
            
            {/* Category title */}
            <div className="flex items-center gap-2 px-1">
              <span className={`w-1 h-3 rounded-full bg-gradient-to-b ${cat.color}`}></span>
              <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{cat.title}</h4>
            </div>

            {/* Blocks in Category */}
            <div className="space-y-1.5">
              {cat.items.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    onClick={() => onAddBlock(item.type)}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-slate-200/80 bg-white p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/20 hover:shadow-[0_4px_12px_rgba(15,115,209,0.04)] active:scale-[0.98]"
                  >
                    <div className={`w-8.5 h-8.5 flex shrink-0 items-center justify-center rounded-lg border transition-all ${item.iconColor} shadow-sm group-hover:scale-105`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h5 className="text-[11px] font-bold text-slate-800 group-hover:text-blue-900 leading-tight">{item.label}</h5>
                      <p className="text-[9px] text-slate-400 truncate mt-0.5 leading-tight">{item.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

          </div>
        ))}
      </div>
      
    </div>
  );
}
