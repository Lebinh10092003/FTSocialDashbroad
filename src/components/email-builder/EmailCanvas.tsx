import React, { useRef, useEffect } from 'react';
import { 
  ArrowUp, 
  ArrowDown, 
  Copy, 
  Trash2, 
  Eye, 
  EyeOff, 
  Settings, 
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
        // Insert variable text node
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
          // Append to end if no selection
          ref.innerHTML += `{{${varName}}}`;
        }
        
        // Trigger save
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

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100 p-6 md:p-10 flex flex-col items-center">
      
      {/* Outer frame matching settings */}
      <div 
        className="w-full shadow-lg border border-slate-200 transition-all duration-300"
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
                className={`relative group border rounded-xl transition-all duration-200 ${
                  isSelected 
                    ? 'border-blue-500 ring-2 ring-blue-100' 
                    : 'border-transparent hover:border-slate-300 hover:dashed'
                } ${!block.visible ? 'opacity-40 bg-slate-50 border-slate-200' : ''}`}
                style={{
                  marginTop: `${marginTop}px`,
                  marginBottom: `${marginBottom}px`
                }}
              >
                
                {/* Visual Block Actions Overlay (Sticky when selected or on hover) */}
                <div className="absolute -top-4.5 right-2 z-30 hidden group-hover:flex items-center gap-1 bg-white border border-slate-250/60 p-1 rounded-lg shadow-md animate-fade-in scale-90 origin-right">
                  <button
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveBlock(block.id, 'up');
                    }}
                    title="Di chuyển lên"
                    className="p-1 hover:bg-slate-100 disabled:opacity-30 text-slate-500 rounded-md cursor-pointer flex items-center justify-center"
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
                    className="p-1 hover:bg-slate-100 disabled:opacity-30 text-slate-500 rounded-md cursor-pointer flex items-center justify-center"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateBlock(block.id);
                    }}
                    title="Nhân bản block"
                    className="p-1 hover:bg-slate-100 text-slate-500 rounded-md cursor-pointer flex items-center justify-center"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisibility(block.id);
                    }}
                    title={block.visible ? 'Ẩn block này' : 'Hiện block này'}
                    className="p-1 hover:bg-slate-100 text-slate-500 rounded-md cursor-pointer flex items-center justify-center"
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
                    title="Xóa block"
                    className="p-1 hover:bg-rose-50 text-rose-600 rounded-md cursor-pointer flex items-center justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Status indicator when hidden */}
                {!block.visible && (
                  <div className="absolute top-1 left-1 text-[8px] bg-rose-100 border border-rose-200 text-rose-600 px-1.5 py-0.5 rounded font-extrabold uppercase select-none z-10 pointer-events-none">
                    Bị ẩn trong email đầu ra
                  </div>
                )}

                {/* Render specific blocks inside workspace editor canvas */}
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
                        <div className="bg-slate-100 p-4 border border-dashed border-slate-300 text-[11px] font-bold text-slate-450 rounded-xl text-center w-full max-w-[200px]">
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
                        className="outline-none min-h-[40px] focus:bg-slate-50/50 p-1.5 rounded-lg border border-transparent focus:border-slate-200 font-sans"
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
                        <div className="bg-slate-100 p-10 border border-dashed border-slate-300 text-[11px] font-bold text-slate-450 rounded-xl text-center w-full">
                          [Chưa nhập đường dẫn ảnh banner]
                        </div>
                      )}
                    </div>
                  )}

                  {/* BULLET & NUMBER LIST BLOCKS */}
                  {(block.type === 'bullet-list' || block.type === 'number-list') && (
                    <div className="pl-4">
                      {block.type === 'number-list' ? (
                        <ol className="list-decimal space-y-1 ml-4 font-sans text-sm">
                          {(content.items || []).map((item: string, i: number) => (
                            <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
                          ))}
                        </ol>
                      ) : (
                        <ul className="list-disc space-y-1 ml-4 font-sans text-sm">
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
                        className="px-6 py-2.5 text-center font-bold text-sm shadow-sm select-none border border-black/5"
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
                        className="px-5 py-2 text-center font-bold text-xs shadow-sm select-none"
                      >
                        {content.btn1?.text || 'Nút 1'}
                      </div>
                      <div 
                        style={{
                          backgroundColor: content.btn2?.bg || '#f1f5f9',
                          color: content.btn2?.color || '#0f3a72',
                          borderRadius: `${content.btn2?.radius ?? 8}px`
                        }}
                        className="px-5 py-2 text-center font-bold text-xs shadow-sm border border-slate-200 select-none"
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
  );
}
