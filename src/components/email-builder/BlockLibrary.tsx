import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Icons from 'lucide-react';
import { BlockType } from '../../types/emailBuilder';
import { BLOCK_CATEGORIES, EMAIL_BLOCK_REGISTRY } from '../../data/emailBlockRegistry';

interface BlockLibraryProps { onAddBlock: (type: BlockType) => void; width: number; }
interface TooltipState { id: string; label: string; description: string; x: number; y: number; }

export default function BlockLibrary({ onAddBlock, width }: BlockLibraryProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [draggingBlock, setDraggingBlock] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);
  const longPress = useRef(false);
  const didDrag = useRef(false);
  // Grow cards to their comfortable size before introducing another column.
  // The same thresholds are used in reverse while shrinking, avoiding asymmetric jumps.
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

  return <aside className="flex h-full min-w-[96px] flex-col border-r border-slate-200/80 bg-white" style={{ width }}>
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
      <Icons.Layers3 className="h-4 w-4 text-[#0F3A72]" aria-hidden="true" />
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Khối nội dung</span>
    </div>
    <div className="flex-1 overflow-y-auto px-2 py-3">
      {BLOCK_CATEGORIES.map(category => {
        const blocks = Object.values(EMAIL_BLOCK_REGISTRY).filter(item => item.category === category.id);
        return <section key={category.id} className="mb-4">
          <h3 className="mb-2 px-1 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{category.label}</h3>
          <div className="grid w-full transition-[grid-template-columns,gap] duration-150 ease-out" style={{ gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`, columnGap: `${gap}px`, rowGap: `${gap}px` }}>
            {blocks.map(item => {
              const Icon = (Icons as any)[item.icon] || Icons.Square;
              return <button key={item.id} type="button" draggable aria-label={item.label} onDragStart={e => { didDrag.current = true; e.dataTransfer.setData('application/x-ft-email-block', item.id); e.dataTransfer.effectAllowed = 'copy'; setDraggingBlock(item.id); hideTooltip(); }} onDragEnd={() => { setDraggingBlock(null); window.setTimeout(() => { didDrag.current = false; }, 0); }} onPointerEnter={e => showTooltip(item.id, item.label, item.description, e.currentTarget)} onPointerLeave={hideTooltip} onFocus={e => showTooltip(item.id, item.label, item.description, e.currentTarget)} onBlur={hideTooltip} onPointerDown={e => startPress(item.id, item.label, item.description, e)} onPointerUp={endPress} onPointerCancel={endPress} onClick={() => { if (didDrag.current) return; if (longPress.current) { longPress.current = false; return; } onAddBlock(item.id); }} className={"group flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-1.5 text-center transition-[transform,border-color,background-color] duration-150 hover:-translate-y-px hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 " + (draggingBlock === item.id ? "scale-95 cursor-grabbing opacity-45" : "cursor-grab")}>
                <Icon className="h-[18px] w-[18px] shrink-0 text-[#0F3A72]" aria-hidden="true" />
                <span className="line-clamp-2 text-[9px] font-bold leading-[12px] text-slate-600 group-hover:text-[#0F3A72]">{item.label}</span>
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
    {tooltip && typeof document !== 'undefined' && createPortal(<div role="tooltip" className="pointer-events-none fixed z-[100] w-[220px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white shadow-xl" style={{ left: tooltip.x, top: tooltip.y }}><p className="text-[11px] font-bold">{tooltip.label}</p><p className="mt-0.5 text-[10px] leading-snug text-slate-300">{tooltip.description}</p></div>, document.body)}
  </aside>;
}
