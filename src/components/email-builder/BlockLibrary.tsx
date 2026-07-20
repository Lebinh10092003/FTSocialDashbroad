import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Icons from 'lucide-react';
import { BlockType } from '../../types/emailBuilder';
import { BLOCK_CATEGORIES, EMAIL_BLOCK_REGISTRY } from '../../data/emailBlockRegistry';

interface BlockLibraryProps { onAddBlock: (type: BlockType) => void; width: number; }
interface TooltipState { id: string; label: string; description: string; x: number; y: number; }

// Hệ màu Bento sáng tạo cho từng khối nội dung
const getBlockVisuals = (id: string) => {
  const visuals: Record<string, { bg: string; iconBg: string; text: string; border: string; glow: string }> = {
    // Media / Structural
    logo: { 
      bg: 'hover:bg-indigo-50/50', 
      iconBg: 'bg-indigo-100/60 text-indigo-600', 
      text: 'group-hover:text-indigo-700', 
      border: 'hover:border-indigo-200', 
      glow: 'hover:shadow-indigo-100/80 hover:shadow-lg' 
    },
    image: { 
      bg: 'hover:bg-emerald-50/50', 
      iconBg: 'bg-emerald-100/60 text-emerald-600', 
      text: 'group-hover:text-emerald-700', 
      border: 'hover:border-emerald-200', 
      glow: 'hover:shadow-emerald-100/80 hover:shadow-lg' 
    },
    // Typography
    heading: { 
      bg: 'hover:bg-amber-50/50', 
      iconBg: 'bg-amber-100/60 text-amber-600', 
      text: 'group-hover:text-amber-700', 
      border: 'hover:border-amber-200', 
      glow: 'hover:shadow-amber-100/80 hover:shadow-lg' 
    },
    paragraph: { 
      bg: 'hover:bg-blue-50/50', 
      iconBg: 'bg-blue-100/60 text-blue-600', 
      text: 'group-hover:text-blue-700', 
      border: 'hover:border-blue-200', 
      glow: 'hover:shadow-blue-100/80 hover:shadow-lg' 
    },
    'icon-text': { 
      bg: 'hover:bg-cyan-50/50', 
      iconBg: 'bg-cyan-100/60 text-cyan-600', 
      text: 'group-hover:text-cyan-700', 
      border: 'hover:border-cyan-200', 
      glow: 'hover:shadow-cyan-100/80 hover:shadow-lg' 
    },
    // Lists
    'bullet-list': { 
      bg: 'hover:bg-teal-50/50', 
      iconBg: 'bg-teal-100/60 text-teal-600', 
      text: 'group-hover:text-teal-700', 
      border: 'hover:border-teal-200', 
      glow: 'hover:shadow-teal-100/80 hover:shadow-lg' 
    },
    'number-list': { 
      bg: 'hover:bg-sky-50/50', 
      iconBg: 'bg-sky-100/60 text-sky-600', 
      text: 'group-hover:text-sky-700', 
      border: 'hover:border-sky-200', 
      glow: 'hover:shadow-sky-100/80 hover:shadow-lg' 
    },
    // Actions / Buttons
    button: { 
      bg: 'hover:bg-violet-50/50', 
      iconBg: 'bg-violet-100/60 text-violet-600', 
      text: 'group-hover:text-violet-700', 
      border: 'hover:border-violet-200', 
      glow: 'hover:shadow-violet-100/80 hover:shadow-lg' 
    },
    'button-group': { 
      bg: 'hover:bg-purple-50/50', 
      iconBg: 'bg-purple-100/60 text-purple-600', 
      text: 'group-hover:text-purple-700', 
      border: 'hover:border-purple-200', 
      glow: 'hover:shadow-purple-100/80 hover:shadow-lg' 
    },
    'button-group-3': { 
      bg: 'hover:bg-fuchsia-50/50', 
      iconBg: 'bg-fuchsia-100/60 text-fuchsia-600', 
      text: 'group-hover:text-fuchsia-700', 
      border: 'hover:border-fuchsia-200', 
      glow: 'hover:shadow-fuchsia-100/80 hover:shadow-lg' 
    },
    // Structural / Spacers
    divider: { 
      bg: 'hover:bg-slate-50', 
      iconBg: 'bg-slate-100 text-slate-500', 
      text: 'group-hover:text-slate-700', 
      border: 'hover:border-slate-300', 
      glow: 'hover:shadow-slate-100/80 hover:shadow-md' 
    },
    spacer: { 
      bg: 'hover:bg-zinc-55', 
      iconBg: 'bg-zinc-100 text-zinc-400', 
      text: 'group-hover:text-zinc-650', 
      border: 'hover:border-zinc-300', 
      glow: 'hover:shadow-zinc-100/80 hover:shadow-md' 
    },
    columns: { 
      bg: 'hover:bg-rose-50/50', 
      iconBg: 'bg-rose-100/60 text-rose-600', 
      text: 'group-hover:text-rose-700', 
      border: 'hover:border-rose-200', 
      glow: 'hover:shadow-rose-100/80 hover:shadow-lg' 
    },
    section: { 
      bg: 'hover:bg-emerald-50/50', 
      iconBg: 'bg-emerald-100/60 text-emerald-500', 
      text: 'group-hover:text-emerald-700', 
      border: 'hover:border-emerald-250', 
      glow: 'hover:shadow-emerald-100/80 hover:shadow-lg' 
    },
    // Containers & Data
    'highlight-box': { 
      bg: 'hover:bg-rose-50/50', 
      iconBg: 'bg-rose-100/60 text-rose-500', 
      text: 'group-hover:text-rose-700', 
      border: 'hover:border-rose-200', 
      glow: 'hover:shadow-rose-100/80 hover:shadow-lg' 
    },
    signature: { 
      bg: 'hover:bg-orange-50/50', 
      iconBg: 'bg-orange-100/60 text-orange-600', 
      text: 'group-hover:text-orange-700', 
      border: 'hover:border-orange-200', 
      glow: 'hover:shadow-orange-100/80 hover:shadow-lg' 
    },
    'social-links': { 
      bg: 'hover:bg-teal-50/50', 
      iconBg: 'bg-teal-100/60 text-teal-600', 
      text: 'group-hover:text-teal-700', 
      border: 'hover:border-teal-200', 
      glow: 'hover:shadow-teal-100/80 hover:shadow-lg' 
    },
    'data-table': { 
      bg: 'hover:bg-blue-50/50', 
      iconBg: 'bg-blue-100/60 text-blue-550', 
      text: 'group-hover:text-blue-700', 
      border: 'hover:border-blue-200', 
      glow: 'hover:shadow-blue-100/80 hover:shadow-lg' 
    },
    'custom-html': { 
      bg: 'hover:bg-red-50/50', 
      iconBg: 'bg-red-100/60 text-red-500', 
      text: 'group-hover:text-red-700', 
      border: 'hover:border-red-200', 
      glow: 'hover:shadow-red-100/80 hover:shadow-lg' 
    }
  };
  return visuals[id] || { 
    bg: 'hover:bg-slate-50', 
    iconBg: 'bg-slate-100 text-slate-600', 
    text: 'group-hover:text-slate-800', 
    border: 'hover:border-slate-300', 
    glow: 'hover:shadow-slate-100/50 hover:shadow-md' 
  };
};

export default function BlockLibrary({ onAddBlock, width }: BlockLibraryProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [draggingBlock, setDraggingBlock] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);
  const longPress = useRef(false);
  const didDrag = useRef(false);

  const contentWidth = Math.max(72, width - 16);
  const columns = 4;
  const maximumCardWidth = 104;
  const cardWidth = Math.min(maximumCardWidth, contentWidth / (columns + 0.12 * Math.max(0, columns - 1)));
  const gap = cardWidth * 0.12;

  const showTooltip = (id: string, label: string, description: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 220;
    const canPlaceRight = rect.right + 12 + tooltipWidth < window.innerWidth;
    setTooltip({ id, label, description, x: canPlaceRight ? rect.right + 10 : Math.max(8, rect.left - tooltipWidth - 10), y: Math.max(8, rect.top) });
  };
  const hideTooltip = () => setTooltip(null);
  const startPress = (id: string, label: string, description: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse') pressTimer.current = window.setTimeout(() => { longPress.current = true; showTooltip(id, label, description, event.currentTarget); }, 450);
  };
  const endPress = () => { if (pressTimer.current) window.clearTimeout(pressTimer.current); pressTimer.current = null; };

  return <aside className="flex h-full min-w-[96px] flex-col border-r border-slate-200/80 bg-slate-50/50" style={{ width }}>
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200/60 bg-white px-3.5">
      <Icons.Layers3 className="h-4.5 w-4.5 text-[#0F3A72]" aria-hidden="true" />
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-700" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Khối nội dung</span>
    </div>
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
      {BLOCK_CATEGORIES.map(category => {
        const blocks = Object.values(EMAIL_BLOCK_REGISTRY).filter(item => item.category === category.id);
        return <section key={category.id} className="bg-white rounded-2xl border border-slate-100 p-2.5 shadow-sm">
          <h3 className="mb-2.5 px-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-slate-450" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{category.label}</h3>
          <div className="grid w-full transition-[grid-template-columns,gap] duration-150 ease-out" style={{ gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`, columnGap: `${gap}px`, rowGap: `${gap}px` }}>
            {blocks.map(item => {
              const Icon = (Icons as any)[item.icon] || Icons.Square;
              const vis = getBlockVisuals(item.id);
              
              return <button 
                key={item.id} 
                type="button" 
                draggable 
                aria-label={item.label} 
                onDragStart={e => { 
                  didDrag.current = true; 
                  e.dataTransfer.setData('application/x-ft-email-block', item.id); 
                  e.dataTransfer.effectAllowed = 'copy'; 
                  setDraggingBlock(item.id); 
                  hideTooltip(); 
                }} 
                onDragEnd={() => { 
                  setDraggingBlock(null); 
                  window.setTimeout(() => { didDrag.current = false; }, 0); 
                }} 
                onPointerEnter={e => showTooltip(item.id, item.label, item.description, e.currentTarget)} 
                onPointerLeave={hideTooltip} 
                onFocus={e => showTooltip(item.id, item.label, item.description, e.currentTarget)} 
                onBlur={hideTooltip} 
                onPointerDown={e => startPress(item.id, item.label, item.description, e)} 
                onPointerUp={endPress} 
                onPointerCancel={endPress} 
                onClick={() => { 
                  if (didDrag.current) return; 
                  if (longPress.current) { 
                    longPress.current = false; 
                    return; 
                  } 
                  onAddBlock(item.id); 
                }} 
                className={`group flex h-[82px] flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 text-center transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-400 ${vis.bg} ${vis.border} ${vis.glow} ${draggingBlock === item.id ? "scale-95 cursor-grabbing opacity-40" : "cursor-grab hover:scale-[1.03]"}`}
              >
                <div className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110 ${vis.iconBg}`}>
                  <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                </div>
                <span className={`line-clamp-2 text-[9px] font-bold leading-[11px] text-slate-500 transition-colors duration-300 ${vis.text}`} style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  {item.label}
                </span>
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
    {tooltip && typeof document !== 'undefined' && createPortal(<div role="tooltip" className="pointer-events-none fixed z-[100] w-[220px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white shadow-xl" style={{ left: tooltip.x, top: tooltip.y }}><p className="text-[11px] font-bold">{tooltip.label}</p><p className="mt-0.5 text-[10px] leading-snug text-slate-300">{tooltip.description}</p></div>, document.body)}
  </aside>;
}
