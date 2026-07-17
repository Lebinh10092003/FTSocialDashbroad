import React, { useRef, useEffect } from 'react';
import { 
  ArrowUp, 
  ArrowDown, 
  Copy, 
  Trash2, 
  Eye, 
  EyeOff, 
  Tag,
  Plus,
  GripVertical
} from 'lucide-react';
import { BlockType, EmailBlock, EmailSettings } from '../../types/emailBuilder';
import { BLOCK_CATEGORIES, EMAIL_BLOCK_REGISTRY } from '../../data/emailBlockRegistry';
import BlockToolbar from './BlockToolbar';
import { sanitizeCustomHtml } from '../../lib/emailSanitizer';

function NewBlockPreview({ block }: { block: EmailBlock }) {
  const c = block.content;
  if (block.type === 'custom-html') return <iframe title="Custom HTML preview" sandbox="" srcDoc={`<!doctype html><html><body style="margin:0">${sanitizeCustomHtml(c.html || '')}</body></html>`} className="min-h-[100px] w-full rounded border border-slate-200 bg-white" />;
  if (block.type === 'gallery') return <div className="grid grid-cols-2 gap-2">{(c.images || ['', '']).map((url: string, i: number) => url ? <img key={i} src={url} alt="" className="h-24 w-full rounded object-cover" /> : <div key={i} className="flex h-24 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">\u1ea2nh {i + 1}</div>)}</div>;
  if (['columns', 'feature-list', 'product-grid', 'pricing-table', 'data-table'].includes(block.type)) { const items = c.items || c.products || c.plans || c.rows || []; return <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${c.variant === 'three' ? 3 : c.variant === 'four' ? 4 : 2}, minmax(0, 1fr))` }}>{items.map((item: any, i: number) => <div key={i} className="rounded border border-slate-200 bg-white p-2 text-xs"><strong>{Array.isArray(item) ? item[0] : item.title || item.name}</strong><p className="mt-1 text-slate-500">{Array.isArray(item) ? item.slice(1).join(' \u2014 ') : item.body || item.price || item.features}</p></div>)}</div>; }
  if (block.type === 'image-text' || block.type === 'product-card' || block.type === 'video') return <div className="grid grid-cols-2 gap-3 rounded bg-slate-50 p-3"><div className="flex min-h-24 items-center justify-center rounded bg-slate-200 text-slate-400">{c.imageUrl ? <img src={c.imageUrl} alt="" className="max-h-32 max-w-full object-cover" /> : '\u1ea2nh'}</div><div><strong className="text-[#0F3A72]">{c.heading || c.name || c.title}</strong><p className="mt-1 text-xs text-slate-600">{c.body || c.description || c.price}</p></div></div>;
  if (block.type === 'callout' || block.type === 'section' || block.type === 'testimonial' || block.type === 'merge-tag') return <div className="rounded border-l-4 border-[#0F3A72] bg-blue-50 p-3 text-sm"><strong>{c.heading || c.title || c.author}</strong><p className="mt-1">{c.body || c.quote || c.text}</p></div>;
  if (block.type === 'header' || block.type === 'footer') return <div className="rounded bg-slate-100 p-3 text-center text-xs text-slate-600">{block.type === 'header' ? c.navigation : `${c.company} \u00b7 ${c.address}`}</div>;
  return null;
}

interface EmailCanvasProps {
  blocks: EmailBlock[];
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onMoveBlock: (id: string, direction: 'up' | 'down') => void;
  onDuplicateBlock: (id: string) => void;
  onDeleteBlock: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onUpdateBlockContent: (id: string, content: Record<string, any>) => void;
  onOpenVariablePicker: () => void;
  insertedVarName: { blockId: string; varName: string } | null;
  onClearInsertedVar: () => void;
  emailSettings: EmailSettings;
  onAddBlock: (type: BlockType, parentId?: string) => void;
  onDropBlock: (sourceId: string, targetId: string) => void;
}

export default function EmailCanvas({
  blocks,
  selectedBlockId,
  onSelectBlock,
  onMoveBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onToggleVisibility,
  onUpdateBlockContent,
  onOpenVariablePicker,
  insertedVarName,
  onClearInsertedVar,
  emailSettings,
  onAddBlock,
  onDropBlock
}: EmailCanvasProps) {
  
  const contentEditableRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [isInserterOpen, setIsInserterOpen] = React.useState(false);
  const [blockQuery, setBlockQuery] = React.useState('');
  const [isBlockDragOver, setIsBlockDragOver] = React.useState(false);  const handleDropOnBlock = (event: React.DragEvent, target: EmailBlock) => {
    event.preventDefault(); event.stopPropagation();
    const sourceId = event.dataTransfer.getData('application/x-ft-email-block-id');
    const type = event.dataTransfer.getData('application/x-ft-email-block') as BlockType;
    if (sourceId) onDropBlock(sourceId, target.id);
    else if (type && EMAIL_BLOCK_REGISTRY[type]) onAddBlock(type, target.type === 'section' ? target.id : undefined);
  };
  const addFromInserter = (type: BlockType) => { onAddBlock(type); setIsInserterOpen(false); setBlockQuery(''); };
  const handleBlockDrop = (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsBlockDragOver(false); const type = event.dataTransfer.getData('application/x-ft-email-block') as BlockType; if (type && EMAIL_BLOCK_REGISTRY[type]) onAddBlock(type); };

  // Insert variable at cursor inside the contenteditable
  useEffect(() => {
    if (insertedVarName) {
      const { blockId, varName } = insertedVarName;
      const ref = contentEditableRefs.current[blockId];
      if (ref) {
        ref.focus();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode(`{{${varName}}}`);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          ref.innerHTML += `{{${varName}}}`;
        }
        
        onUpdateBlockContent(blockId, {
          ...blocks.find(b => b.id === blockId)?.content,
          html: ref.innerHTML
        });
      }
      onClearInsertedVar();
    }
  }, [insertedVarName]);

  const handleContentBlur = (blockId: string, html: string) => {
    const block = blocks.find(b => b.id === blockId);
    if (block && block.content.html !== html) {
      onUpdateBlockContent(blockId, {
        ...block.content,
        html
      });
    }
  };

  const handleParagraphAlignChange = (blockId: string, align: 'left' | 'center' | 'right') => {
    const block = blocks.find(b => b.id === blockId);
    if (block) {
      onUpdateBlockContent(blockId, {
        ...block.content,
        align
      });
    }
  };

  // Helper: Display Vietnamese type name for block badges
  const getBlockTypeName = (type: string) => {
    switch (type) {
      case 'logo': return 'Logo';
      case 'heading': return 'Tiêu đề';
      case 'paragraph': return 'Đoạn văn';
      case 'image': return 'Ảnh banner';
      case 'bullet-list': return 'Danh sách chấm';
      case 'number-list': return 'Danh sách số';
      case 'button': return 'Nút bấm CTA';
      case 'button-group': return 'Nhóm 2 nút';
      case 'highlight-box': return 'Hộp thông tin';
      case 'divider': return 'Đường kẻ';
      case 'spacer': return 'Khoảng trống';
      case 'signature': return 'Chữ ký BTC';
      case 'social-links': return 'Mạng xã hội';
      default: return 'Khối';
    }
  };

  return (
    <div className="flex w-full flex-col items-center px-4 py-6 select-text md:px-8 md:py-8">
      <div
        className="flex w-full max-w-full flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]"
        style={{ maxWidth: `${emailSettings.maxWidth + 72}px` }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 select-none">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email canvas</p>
            <p className="mt-0.5 text-xs font-bold text-slate-700">Kéo khối từ trái, chọn khối để chỉnh bên phải</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">
            {emailSettings.maxWidth}px
          </div>
        </div>

        {/* Email content viewport frame */}
        <div onDragOver={event => { if (event.dataTransfer.types.includes('application/x-ft-email-block')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsBlockDragOver(true); } }} onDragLeave={event => { if (event.currentTarget === event.target) setIsBlockDragOver(false); }} onDrop={handleBlockDrop} className="relative flex min-h-[520px] w-full justify-center bg-[#f5f6f8] p-5 md:p-8">
          {isBlockDragOver && <div className="pointer-events-none absolute inset-5 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/90 text-sm font-black text-[#0F3A72] shadow-sm">Drop block here</div>}
          <div 
            className="relative w-full border border-slate-200/70 bg-white shadow-[0_6px_24px_rgba(15,23,42,0.05)] transition-all duration-300"
            style={{
              maxWidth: `${emailSettings.maxWidth}px`,
              backgroundColor: emailSettings.contentBg,
              borderRadius: `${emailSettings.borderRadius}px`,
              fontFamily: emailSettings.fontFamily || 'Arial, sans-serif',
              color: emailSettings.textColor || '#1e293b',
            }}
          >
            <div style={{ padding: `${emailSettings.contentPadding}px` }} className="space-y-4">
              
              {blocks.map((block, index) => {
                const isSelected = selectedBlockId === block.id;
                const content = block.content;
                const styles = block.styles;
                const marginTop = styles.marginTop ?? 10;
                const marginBottom = styles.marginBottom ?? 10;

                return (
                  <div
                    key={block.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectBlock(block.id);
                    }}
                    className={`relative group border transition-all duration-200 ${
                      isSelected 
                        ? 'border-blue-500 ring-2 ring-blue-100 rounded-xl bg-blue-50/5' 
                        : 'border-transparent hover:border-slate-350 hover:dashed rounded-xl hover:bg-slate-50/20'
                    } ${!block.visible ? 'opacity-40 bg-slate-55/60 border-slate-250/50 border-dashed rounded-xl' : ''}`}
                    style={{
                      marginTop: `${marginTop}px`,
                      marginBottom: `${marginBottom}px`
                    }}
                  >
                    
                    {/* Visual Hover Badge - Shows block type */}
                    <div className="absolute -top-3.5 left-3.5 z-20 bg-blue-600 border border-blue-500/20 text-white text-[9px] font-black tracking-widest px-2 py-0.5 rounded-md shadow-sm uppercase scale-90 group-hover:flex hidden select-none">
                      {getBlockTypeName(block.type)}
                    </div>

                    {/* Actions Controller Box (Top Right Corner) */}
                    <div className="absolute -top-4.5 right-3 z-30 hidden group-hover:flex items-center gap-1 bg-white border border-slate-200 p-1.5 rounded-xl shadow-lg scale-90 origin-right select-none">
                      <button draggable onDragStart={event => { event.dataTransfer.setData('application/x-ft-email-block-id', block.id); event.dataTransfer.effectAllowed = 'move'; }} title="Kéo để sắp xếp hoặc thả vào Section" className="p-1 hover:bg-slate-100 text-slate-550 rounded-lg cursor-grab active:cursor-grabbing flex items-center justify-center"><GripVertical className="w-3.5 h-3.5" /></button>
                      <button
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveBlock(block.id, 'up');
                        }}
                        title="Di chuyển lên"
                        className="p-1 hover:bg-slate-100 disabled:opacity-20 text-slate-550 rounded-lg cursor-pointer flex items-center justify-center"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={index === blocks.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveBlock(block.id, 'down');
                        }}
                        title="Di chuyển xuống"
                        className="p-1 hover:bg-slate-100 disabled:opacity-20 text-slate-550 rounded-lg cursor-pointer flex items-center justify-center"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicateBlock(block.id);
                        }}
                        title="Nhân bản khối"
                        className="p-1 hover:bg-slate-100 text-slate-550 rounded-lg cursor-pointer flex items-center justify-center"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleVisibility(block.id);
                        }}
                        title={block.visible ? 'Ẩn khối' : 'Hiện khối'}
                        className="p-1 hover:bg-slate-100 text-slate-550 rounded-lg cursor-pointer flex items-center justify-center"
                      >
                        {block.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-rose-500" />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Bạn chắc chắn muốn xóa khối này?')) {
                            onDeleteBlock(block.id);
                          }
                        }}
                        title="Xóa khối"
                        className="p-1 hover:bg-rose-50 text-rose-600 rounded-lg cursor-pointer flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Hidden overlay marker */}
                    {!block.visible && (
                      <div className="absolute top-1 right-1 text-[8px] bg-rose-100 border border-rose-200 text-rose-600 px-1.5 py-0.5 rounded font-black uppercase select-none z-10 pointer-events-none">
                        Bị ẩn
                      </div>
                    )}

                    {/* Render specific blocks */}
                    <div className="p-3">
                      
                      {/* LOGO BLOCK */}
                      {block.type === 'logo' && (
                        <div className={`flex justify-${content.align === 'center' ? 'center' : content.align === 'right' ? 'end' : 'start'}`}>
                          {content.url ? (
                            <img 
                              src={content.url} 
                              alt={content.alt || 'Logo'} 
                              style={{ width: `${content.width || 120}px` }}
                              className="max-w-full height-auto object-contain pointer-events-none"
                            />
                          ) : (
                            <div className="bg-slate-50 p-4 border border-dashed border-slate-350/50 text-[10px] font-bold text-slate-450 rounded-xl text-center w-full max-w-[200px]">
                              [Chưa nhập ảnh Logo]
                            </div>
                          )}
                        </div>
                      )}

                      {/* HEADING BLOCK */}
                      {block.type === 'heading' && (
                        <div
                          style={{
                            textAlign: content.align || 'left',
                            color: content.color || '#0f3a72',
                            fontSize: `${content.fontSize || 18}px`,
                            fontWeight: content.bold ? 'bold' : 'normal'
                          }}
                          className="font-sans leading-snug"
                        >
                          {content.text || '[Chưa nhập tiêu đề]'}
                        </div>
                      )}

                      {/* PARAGRAPH BLOCK */}
                      {block.type === 'paragraph' && (
                        <div>
                          {isSelected && (
                            <BlockToolbar 
                              onInsertVariableClick={onOpenVariablePicker}
                              onAlignChange={(align) => handleParagraphAlignChange(block.id, align)}
                              activeAlign={content.align || 'left'}
                            />
                          )}
                          <div
                            ref={(el) => { contentEditableRefs.current[block.id] = el; }}
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => handleContentBlur(block.id, e.target.innerHTML)}
                            style={{ textAlign: content.align || 'left' }}
                            className="outline-none min-h-[40px] focus:bg-slate-50/50 p-1 rounded-lg border border-transparent focus:border-slate-200 font-sans"
                            dangerouslySetInnerHTML={{ __html: content.html || '<p><br></p>' }}
                          />
                        </div>
                      )}

                      {/* IMAGE BLOCK */}
                      {block.type === 'image' && (
                        <div className={`flex justify-${content.align === 'center' ? 'center' : content.align === 'right' ? 'end' : 'start'}`}>
                          {content.url ? (
                            <img 
                              src={content.url} 
                              alt={content.alt || 'Banner'} 
                              style={{ 
                                width: `${content.width || 600}px`,
                                borderRadius: `${content.borderRadius || 0}px` 
                              }}
                              className="max-w-full height-auto object-cover pointer-events-none"
                            />
                          ) : (
                            <div className="bg-slate-50 p-8 border border-dashed border-slate-350/50 text-[10px] font-bold text-slate-450 rounded-xl text-center w-full">
                              [Chưa nhập đường dẫn ảnh banner]
                            </div>
                          )}
                        </div>
                      )}

                      {/* BULLET & NUMBER LIST BLOCKS */}
                      {(block.type === 'bullet-list' || block.type === 'number-list') && (
                        <div className="pl-4">
                          {block.type === 'number-list' ? (
                            <ol className="list-decimal space-y-1.5 ml-4 font-sans text-sm">
                              {(content.items || []).map((item: string, i: number) => (
                                <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
                              ))}
                            </ol>
                          ) : (
                            <ul className="list-disc space-y-1.5 ml-4 font-sans text-sm">
                              {(content.items || []).map((item: string, i: number) => (
                                <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* BUTTON BLOCK */}
                      {block.type === 'button' && (
                        <div className={`flex justify-${content.align === 'center' ? 'center' : content.align === 'right' ? 'end' : 'start'}`}>
                          <div 
                            style={{
                              backgroundColor: content.bg || '#1473d1',
                              color: content.color || '#ffffff',
                              borderRadius: `${content.radius ?? 8}px`,
                              width: content.width === 'full' ? '100%' : 'auto'
                            }}
                            className="px-6 py-2.5 text-center font-extrabold text-sm shadow-sm select-none border border-black/5"
                          >
                            {content.text || 'Nút bấm CTA'}
                          </div>
                        </div>
                      )}

                      {/* ACTION BUTTON GROUP */}
                      {block.type === 'button-group' && (() => { const buttons = content.buttons || [content.btn1, content.btn2].filter(Boolean); return <div className={`flex flex-wrap justify-${content.align === 'left' ? 'start' : content.align === 'right' ? 'end' : 'center'}`} style={{ gap: `${content.gap ?? 12}px` }}>{buttons.map((button: any, i: number) => <div key={i} style={{ backgroundColor: button.bg || '#0F3A72', color: button.color || '#ffffff', borderRadius: `${button.radius ?? 8}px` }} className="px-5 py-2 text-center text-xs font-extrabold shadow-sm">{button.text || `H\u00e0nh \u0111\u1ed9ng ${i + 1}`}</div>)}</div>; })()}

                      {/* HIGHLIGHT BOX BLOCK */}
                      {block.type === 'highlight-box' && (
                        <div>
                          {isSelected && (
                            <BlockToolbar 
                              onInsertVariableClick={onOpenVariablePicker}
                            />
                          )}
                          <div
                            ref={(el) => { contentEditableRefs.current[block.id] = el; }}
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => handleContentBlur(block.id, e.target.innerHTML)}
                            style={{
                              backgroundColor: content.bg || '#eef6ff',
                              borderLeft: `4px solid ${content.borderColor || '#1473d1'}`,
                              padding: `${content.padding ?? 16}px`
                            }}
                            className="outline-none min-h-[40px] focus:bg-slate-50/20 rounded-r-xl border border-transparent font-sans text-sm"
                            dangerouslySetInnerHTML={{ __html: content.html || '<p><br></p>' }}
                          />
                        </div>
                      )}

                      {/* DIVIDER BLOCK */}
                      {block.type === 'divider' && (
                        <div 
                          style={{
                            borderTop: `${styles.thickness ?? 1}px ${styles.borderStyle || 'solid'} ${styles.color || '#e2e8f0'}`
                          }}
                          className="w-full font-size-1"
                        />
                      )}

                      {/* SPACER BLOCK */}
                      {block.type === 'spacer' && (
                        <div 
                          style={{ height: `${styles.height ?? 20}px` }} 
                          className="w-full bg-slate-100/10 border-y border-dashed border-slate-200/20 text-center flex items-center justify-center text-[10px] text-slate-350 select-none"
                        >
                          Khoảng trắng: {styles.height ?? 20}px
                        </div>
                      )}

                      {/* SIGNATURE BLOCK */}
                      {block.type === 'signature' && (
                        <div>
                          {isSelected && (
                            <BlockToolbar 
                              onInsertVariableClick={onOpenVariablePicker}
                            />
                          )}
                          <div
                            ref={(el) => { contentEditableRefs.current[block.id] = el; }}
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => handleContentBlur(block.id, e.target.innerHTML)}
                            className="outline-none min-h-[50px] focus:bg-slate-50/50 p-2 rounded-lg border border-transparent focus:border-slate-200 font-sans text-sm text-slate-650"
                            dangerouslySetInnerHTML={{ __html: content.html || '<p><br></p>' }}
                          />
                        </div>
                      )}

                      {/* SOCIAL LINKS BLOCK */}
                      {block.type === 'social-links' && (
                        <div className={`flex justify-${content.align === 'center' ? 'center' : content.align === 'right' ? 'end' : 'start'} gap-3`}>
                          {(content.links || []).filter((l: any) => l.visible !== false).map((link: any, i: number) => (
                            <span 
                              key={i} 
                              style={{ color: emailSettings.linkColor || '#1473d1' }}
                              className="text-xs font-bold bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg border border-slate-200 select-none"
                            >
                              {link.label}
                            </span>
                          ))}
                        </div>
                      )}

                      {['section', 'columns', 'image-text', 'data-table', 'testimonial', 'callout', 'gallery', 'video', 'feature-list', 'product-card', 'product-grid', 'pricing-table', 'header', 'footer', 'merge-tag', 'custom-html'].includes(block.type) && <NewBlockPreview block={block} />}

                    </div>
                  </div>
                );
              })}

              <div className="relative mt-5 flex justify-center border-t border-dashed border-slate-200 pt-5">
                <button type="button" onClick={() => setIsInserterOpen(open => !open)} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-[#0F3A72] shadow-sm transition hover:bg-blue-50"><Plus className="h-4 w-4" /> Thêm khối nội dung</button>
                {isInserterOpen && <div className="absolute bottom-12 z-40 w-[min(520px,calc(100vw-48px))] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
                  <div className="mb-3 flex items-center gap-2"><Plus className="h-4 w-4 text-[#0F3A72]" /><input autoFocus value={blockQuery} onChange={e => setBlockQuery(e.target.value)} placeholder="Tìm block..." className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500" /></div>
                  <div className="max-h-72 space-y-3 overflow-y-auto pr-1">{BLOCK_CATEGORIES.map(category => { const items = Object.values(EMAIL_BLOCK_REGISTRY).filter(item => item.category === category.id && (item.label + item.description).toLowerCase().includes(blockQuery.toLowerCase())); return items.length ? <div key={category.id}><p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">{category.label}</p><div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{items.map(item => <button key={item.id} type="button" onClick={() => addFromInserter(item.id)} className="rounded-lg border border-slate-200 px-2 py-2 text-left text-[10px] font-bold text-slate-700 hover:border-blue-300 hover:bg-blue-50">{item.label}</button>)}</div></div> : null; })}</div>
                </div>}
              </div>

            </div>
          </div>
        </div>

      </div>
      
    </div>
  );
}
