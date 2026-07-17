import React, { useRef, useEffect } from 'react';
import { 
  ArrowUp, 
  ArrowDown, 
  Copy, 
  Trash2, 
  Eye, 
  EyeOff, 
  Tag,
  Plus
} from 'lucide-react';
import { EmailBlock, EmailSettings } from '../../types/emailBuilder';
import BlockToolbar from './BlockToolbar';

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
  emailSettings
}: EmailCanvasProps) {
  
  const contentEditableRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    <div className="w-full p-4 md:p-8 flex flex-col items-center select-text">
      
      {/* SaaS Browser mockup wrap */}
      <div className="w-full bg-white rounded-3xl border border-slate-200/80 shadow-[0_10px_30px_rgba(15,58,114,0.04)] overflow-hidden flex flex-col max-w-full"
           style={{ maxWidth: `${emailSettings.maxWidth + 60}px` }}>
        
        {/* Browser header bar */}
        <div className="bg-slate-50 border-b border-slate-200/60 px-5 py-3.5 flex items-center gap-4 shrink-0 select-none">
          {/* macOS traffic light buttons */}
          <div className="flex gap-1.5 shrink-0">
            <span className="w-3 h-3 rounded-full bg-rose-400 border border-rose-500/20 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-amber-400 border border-amber-500/20 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-450 border border-emerald-500/20 inline-block"></span>
          </div>

          {/* Browser Address Bar */}
          <div className="flex-1 max-w-md mx-auto bg-slate-200/50 rounded-xl px-4 py-1.5 text-[10px] text-slate-450 font-bold text-center border border-slate-250/20 truncate">
            https://fermat.vn/email-preview/campaign-editor
          </div>
        </div>

        {/* Email content viewport frame */}
        <div className="bg-slate-100/50 p-6 md:p-10 flex justify-center w-full min-h-[500px]">
          <div 
            className="w-full bg-white border border-slate-200/60 shadow-[0_4px_20px_rgba(0,0,0,0.015)] transition-all duration-300 relative"
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

                      {/* BUTTON GROUP BLOCK */}
                      {block.type === 'button-group' && (
                        <div className={`flex justify-${content.align === 'center' ? 'center' : content.align === 'right' ? 'end' : 'start'} gap-4`}>
                          <div 
                            style={{
                              backgroundColor: content.btn1?.bg || '#1473d1',
                              color: content.btn1?.color || '#ffffff',
                              borderRadius: `${content.btn1?.radius ?? 8}px`
                            }}
                            className="px-5 py-2 text-center font-extrabold text-xs shadow-sm select-none"
                          >
                            {content.btn1?.text || 'Nút 1'}
                          </div>
                          <div 
                            style={{
                              backgroundColor: content.btn2?.bg || '#f1f5f9',
                              color: content.btn2?.color || '#0f3a72',
                              borderRadius: `${content.btn2?.radius ?? 8}px`
                            }}
                            className="px-5 py-2 text-center font-extrabold text-xs shadow-sm border border-slate-200 select-none"
                          >
                            {content.btn2?.text || 'Nút 2'}
                          </div>
                        </div>
                      )}

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

                    </div>
                  </div>
                );
              })}

            </div>
          </div>
        </div>

      </div>
      
    </div>
  );
}
