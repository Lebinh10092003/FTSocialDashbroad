import React, { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, ImagePlus, Link, Plus, Trash2 } from 'lucide-react';
import { BlockType, EmailBlock, EmailSettings } from '../../types/emailBuilder';
import { BLOCK_CATEGORIES, EMAIL_BLOCK_REGISTRY } from '../../data/emailBlockRegistry';
import BlockToolbar from './BlockToolbar';
import { sanitizeCustomHtml } from '../../lib/emailSanitizer';
import { addEmailLayoutCell, getLayoutSlotIndex, normalizeEmailLayout, resizeEmailLayout } from '../../lib/emailLayout';
import { getEmailLucideIcon } from '../../lib/emailIcon';

export interface EmailCanvasHandle {
  hasTextSelection: (blockId: string) => boolean;
  applySelectionFontSize: (blockId: string, size: number) => boolean;
  applySelectionTextColor: (blockId: string, color: string) => boolean;
  flushPendingChanges: () => boolean;
}

interface SelectionBookmark { start: number; end: number; }

const EMPTY_EDITABLE_HTML = new Set(['', '<br>', '<div><br></div>', '<p><br></p>']);
const LEGACY_PARAGRAPH_PLACEHOLDER = 'Nội dung đoạn văn mới. Nhấp để chỉnh sửa trực quan.';

const normalizeEditableHtml = (html = '') => {
  const compact = html.replace(/\s+/g, '').toLowerCase();
  return EMPTY_EDITABLE_HTML.has(compact) ? '' : html;
};

const htmlText = (html = '') => html
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const editableHtml = (html = '') => htmlText(html) === LEGACY_PARAGRAPH_PLACEHOLDER
  ? ''
  : normalizeEditableHtml(html);

const editableText = (text = '', legacyPlaceholders: string[] = []) => legacyPlaceholders.includes(text.trim()) ? '' : text;

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
  onAddBlock: (type: BlockType, parentId?: string, slotIndex?: number) => void;
  onDropBlock: (sourceId: string, targetId: string, slotIndex?: number) => void;
  onUpdateBlock: (id: string, block: EmailBlock) => void;
}

const TYPE_NAMES: Partial<Record<BlockType, string>> = {
  logo: 'Logo', heading: 'Tiêu đề', paragraph: 'Đoạn văn', image: 'Ảnh / Banner', button: 'Nút CTA',
  'icon-text': 'Icon + chữ', 'button-group': 'Nhóm 2 nút', 'button-group-3': 'Nhóm 3 nút', 'bullet-list': 'Danh sách gạch đầu dòng', 'number-list': 'Danh sách số',
  'highlight-box': 'Hộp thông tin', divider: 'Đường phân cách', spacer: 'Khoảng trắng', signature: 'Chữ ký',
  'social-links': 'Mạng xã hội', section: 'Section / Container', columns: 'Bố cục ô linh hoạt', 'data-table': 'Bảng dữ liệu'
};

const EmailCanvas = React.forwardRef<EmailCanvasHandle, EmailCanvasProps>(function EmailCanvas(props, ref) {
  const { blocks, selectedBlockId, onSelectBlock, onMoveBlock, onDuplicateBlock, onDeleteBlock, onToggleVisibility, onUpdateBlockContent, onOpenVariablePicker, insertedVarName, onClearInsertedVar, emailSettings, onAddBlock, onDropBlock, onUpdateBlock } = props;
  const editableRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectionRefs = useRef<Record<string, Range | null>>({});
  const selectionBookmarks = useRef<Record<string, SelectionBookmark | null>>({});
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [isInserterOpen, setIsInserterOpen] = React.useState(false);
  const [blockQuery, setBlockQuery] = React.useState('');
  const [rootDragOver, setRootDragOver] = React.useState(false);
  const selectionOverlayRef = useRef<HTMLDivElement | null>(null);

  const updateHtml = (block: EmailBlock, element: HTMLElement) => {
    const html = normalizeEditableHtml(element.innerHTML);
    if (!html) element.innerHTML = '';
    onUpdateBlockContent(block.id, { ...block.content, html });
  };
  const clearSelectionHighlight = () => {
    const highlights = (globalThis.CSS as any)?.highlights;
    highlights?.delete('ft-email-selection');
    selectionOverlayRef.current?.replaceChildren();
  };
  const rangeToBookmark = (editable: HTMLElement, range: Range): SelectionBookmark => {
    const before = range.cloneRange();
    before.selectNodeContents(editable);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    return { start, end: start + range.toString().length };
  };
  const bookmarkToRange = (editable: HTMLElement, bookmark: SelectionBookmark): Range | null => {
    const range = document.createRange();
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let offset = 0;
    let startSet = false;
    while (node) {
      const length = node.textContent?.length || 0;
      if (!startSet && bookmark.start <= offset + length) {
        range.setStart(node, Math.max(0, bookmark.start - offset));
        startSet = true;
      }
      if (startSet && bookmark.end <= offset + length) {
        range.setEnd(node, Math.max(0, bookmark.end - offset));
        return range;
      }
      offset += length;
      node = walker.nextNode();
    }
    if (!startSet) return null;
    range.setEnd(editable, editable.childNodes.length);
    return range;
  };
  const showSelectionHighlight = (range: Range | null) => {
    if (!range || range.collapsed) { clearSelectionHighlight(); return; }
    const highlights = (globalThis.CSS as any)?.highlights;
    const HighlightConstructor = (globalThis as any).Highlight;
    if (highlights && HighlightConstructor) highlights.set('ft-email-selection', new HighlightConstructor(range));
    const overlay = selectionOverlayRef.current;
    if (!overlay) return;
    overlay.replaceChildren();
    Array.from(range.getClientRects())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .forEach(rect => {
        const marker = document.createElement('span');
        marker.className = 'absolute rounded-[2px] bg-blue-600/55 ring-1 ring-blue-700/20';
        marker.style.top = `${rect.top}px`;
        marker.style.left = `${rect.left}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
        overlay.appendChild(marker);
      });
  };
  const getSavedRange = (blockId: string) => {
    const editable = editableRefs.current[blockId];
    if (!editable) return null;
    const current = selectionRefs.current[blockId];
    if (current && editable.contains(current.commonAncestorContainer)) return current;
    const bookmark = selectionBookmarks.current[blockId];
    const restored = bookmark ? bookmarkToRange(editable, bookmark) : null;
    if (restored) selectionRefs.current[blockId] = restored.cloneRange();
    return restored;
  };
  const saveSelection = (blockId: string) => {
    if (selectedBlockId !== blockId) onSelectBlock(blockId);
    const selection = window.getSelection();
    const editable = editableRefs.current[blockId];
    if (!selection?.rangeCount || !editable?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    selectionRefs.current[blockId] = range;
    selectionBookmarks.current[blockId] = rangeToBookmark(editable, range);
    showSelectionHighlight(range);
  };
  const restoreSelection = (blockId: string) => {
    const range = getSavedRange(blockId);
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
  };
  const applySelectionFontSize = (block: EmailBlock, size: number, selectionOnly = false): boolean => {
    const editable = editableRefs.current[block.id];
    if (!editable) return false;
    const savedRange = getSavedRange(block.id);
    const bookmark = selectionBookmarks.current[block.id];
    const hasTextSelection = Boolean(savedRange && !savedRange.collapsed && bookmark && bookmark.end > bookmark.start);

    if (!hasTextSelection) {
      if (selectionOnly) return false;
      editable.querySelectorAll<HTMLElement>('[style]').forEach(element => {
        element.style.removeProperty('font-size');
        if (!element.getAttribute('style')?.trim()) element.removeAttribute('style');
      });
      editable.querySelectorAll('font[size]').forEach(font => {
        const fragment = document.createDocumentFragment();
        while (font.firstChild) fragment.appendChild(font.firstChild);
        font.replaceWith(fragment);
      });
      selectionRefs.current[block.id] = null;
      selectionBookmarks.current[block.id] = null;
      clearSelectionHighlight();
      onUpdateBlockContent(block.id, { ...block.content, fontSize: size, html: editable.innerHTML });
      return false;
    }

    editable.focus({ preventScroll: true });
    restoreSelection(block.id);
    document.execCommand('fontSize', false, '7');
    editable.querySelectorAll('font[size="7"]').forEach(font => {
      const span = document.createElement('span');
      span.style.fontSize = `${size}px`;
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    });
    updateHtml(block, editable);
    selectionBookmarks.current[block.id] = bookmark;
    const nextRange = bookmark ? bookmarkToRange(editable, bookmark) : null;
    selectionRefs.current[block.id] = nextRange?.cloneRange() || null;
    if (nextRange) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
      showSelectionHighlight(nextRange);
    }
    return true;
  };

  const applySelectionTextColor = (block: EmailBlock, color: string, selectionOnly = false): boolean => {
    const editable = editableRefs.current[block.id];
    if (!editable) return false;
    const savedRange = getSavedRange(block.id);
    const bookmark = selectionBookmarks.current[block.id];
    const hasTextSelection = Boolean(savedRange && !savedRange.collapsed && bookmark && bookmark.end > bookmark.start);

    if (!hasTextSelection) {
      if (selectionOnly) return false;
      editable.querySelectorAll<HTMLElement>('[style]').forEach(element => {
        element.style.removeProperty('color');
        if (!element.getAttribute('style')?.trim()) element.removeAttribute('style');
      });
      editable.querySelectorAll('font[color]').forEach(font => {
        const fragment = document.createDocumentFragment();
        while (font.firstChild) fragment.appendChild(font.firstChild);
        font.replaceWith(fragment);
      });
      selectionRefs.current[block.id] = null;
      selectionBookmarks.current[block.id] = null;
      clearSelectionHighlight();
      onUpdateBlockContent(block.id, { ...block.content, color, html: editable.innerHTML });
      return false;
    }

    editable.focus({ preventScroll: true });
    restoreSelection(block.id);
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, color);
    editable.querySelectorAll<HTMLFontElement>('font[color]').forEach(font => {
      const span = document.createElement('span');
      span.style.color = font.color || color;
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    });
    updateHtml(block, editable);
    selectionBookmarks.current[block.id] = bookmark;
    const nextRange = bookmark ? bookmarkToRange(editable, bookmark) : null;
    selectionRefs.current[block.id] = nextRange?.cloneRange() || null;
    if (nextRange) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
      showSelectionHighlight(nextRange);
    }
    return true;
  };

  React.useImperativeHandle(ref, () => ({
    hasTextSelection: blockId => {
      const bookmark = selectionBookmarks.current[blockId];
      return Boolean(bookmark && bookmark.end > bookmark.start && getSavedRange(blockId));
    },
    applySelectionFontSize: (blockId, size) => {
      const previousFocus = document.activeElement as HTMLElement | null;
      const block = findBlock(blocks, blockId);
      const applied = block ? applySelectionFontSize(block, size, true) : false;
      if (applied && previousFocus?.focus) requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
      return applied;
    },
    applySelectionTextColor: (blockId, color) => {
      const previousFocus = document.activeElement as HTMLElement | null;
      const block = findBlock(blocks, blockId);
      const applied = block ? applySelectionTextColor(block, color, true) : false;
      if (applied && previousFocus?.focus) requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
      return applied;
    },
    flushPendingChanges: () => {
      let changed = false;
      Object.entries(editableRefs.current).forEach(([blockId, editableValue]) => {
        const editable = editableValue as HTMLDivElement | null;
        const block = editable ? findBlock(blocks, blockId) : undefined;
        const html = editable ? normalizeEditableHtml(editable.innerHTML) : '';
        if (!editable || !block || html === editableHtml(block.content.html || '')) return;
        if (!html) editable.innerHTML = '';
        onUpdateBlockContent(block.id, { ...block.content, html });
        changed = true;
      });
      return changed;
    },
  }));

  React.useLayoutEffect(() => {
    if (!selectedBlockId) { clearSelectionHighlight(); return; }
    showSelectionHighlight(getSavedRange(selectedBlockId));
  }, [blocks, selectedBlockId]);

  useEffect(() => {
    const refreshOverlay = () => {
      if (selectedBlockId) showSelectionHighlight(getSavedRange(selectedBlockId));
    };
    window.addEventListener('scroll', refreshOverlay, true);
    window.addEventListener('resize', refreshOverlay);
    return () => {
      window.removeEventListener('scroll', refreshOverlay, true);
      window.removeEventListener('resize', refreshOverlay);
    };
  }, [selectedBlockId, blocks]);

  useEffect(() => {
    if (!insertedVarName) return;
    const block = findBlock(blocks, insertedVarName.blockId);
    const editable = editableRefs.current[insertedVarName.blockId];
    if (block && editable) {
      editable.focus(); restoreSelection(block.id);
      document.execCommand('insertText', false, `{{${insertedVarName.varName}}}`);
      updateHtml(block, editable);
    }
    onClearInsertedVar();
  }, [insertedVarName]);

  const setImageMetadata = (block: EmailBlock, url: string) => {
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
      const width = Number(block.content.width) || Math.min(image.naturalWidth, 600);
      onUpdateBlockContent(block.id, { ...block.content, url, width, height: block.content.height || Math.round(width / ratio), naturalRatio: ratio, aspectLocked: block.content.aspectLocked !== false });
    };
    image.src = url;
  };
  const uploadImage = async (block: EmailBlock, file: File) => {
    if (!file.type.startsWith('image/') || file.size > 3 * 1024 * 1024) return;
    try {
      const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const data = await response.json();
      if (data.success && data.url) { setImageMetadata(block, `${window.location.origin}${data.url}`); return; }
    } catch { /* use a portable data URL below */ }
    const reader = new FileReader(); reader.onload = () => setImageMetadata(block, String(reader.result)); reader.readAsDataURL(file);
  };
  const pasteImageUrl = (block: EmailBlock) => {
    const url = prompt('Dán đường dẫn ảnh:', block.content.url || 'https://');
    if (url) setImageMetadata(block, url);
  };
  const setLayoutColumnCount = (block: EmailBlock, count: number) => {
    const state = normalizeEmailLayout(block);
    if (count < state.layout.length) {
      const keepSlots = state.layout.slice(0, count).reduce((total, column) => total + column.cells.length, 0);
      if (state.slots.slice(keepSlots).some(slot => slot.length) && !confirm('Các cột bị xóa đang chứa nội dung. Bạn có chắc muốn tiếp tục?')) return;
    }
    onUpdateBlock(block.id, resizeEmailLayout(block, count));
  };

  const dropInto = (event: React.DragEvent, target: EmailBlock, slotIndex?: number) => {
    event.preventDefault(); event.stopPropagation();
    const sourceId = event.dataTransfer.getData('application/x-ft-email-block-id');
    const type = event.dataTransfer.getData('application/x-ft-email-block') as BlockType;
    if (sourceId) onDropBlock(sourceId, target.id, slotIndex);
    else if (type && EMAIL_BLOCK_REGISTRY[type]) onAddBlock(type, target.id, slotIndex);
  };

  const renderSimplePreview = (block: EmailBlock) => {
    const content = block.content;
    if (block.type === 'custom-html') return <iframe title="Xem trước HTML" sandbox="" srcDoc={`<!doctype html><html><body style="margin:0">${sanitizeCustomHtml(content.html || '')}</body></html>`} className="min-h-24 w-full rounded border bg-white" />;
    if (block.type === 'gallery') return <div className="grid grid-cols-2 gap-2">{(content.images || ['', '']).map((url: string, index: number) => url ? <img key={index} src={url} className="h-24 w-full rounded object-cover" alt="" /> : <div key={index} className="flex h-24 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">Ảnh {index + 1}</div>)}</div>;
    if (['feature-list', 'product-grid', 'pricing-table'].includes(block.type)) { const items = content.items || content.products || content.plans || []; return <div className="grid grid-cols-2 gap-2">{items.map((item: any, index: number) => <div key={index} className="rounded border bg-white p-3 text-xs"><strong>{item.title || item.name}</strong><p className="mt-1 text-slate-500">{item.body || item.price || item.features}</p></div>)}</div>; }
    if (['image-text', 'product-card', 'video'].includes(block.type)) return <div className="grid grid-cols-2 gap-3 rounded bg-slate-50 p-3"><div className="flex min-h-24 items-center justify-center rounded bg-slate-200">{content.imageUrl ? <img src={content.imageUrl} alt="" className="max-h-32 max-w-full" /> : 'Ảnh'}</div><div><strong className="text-[#0F3A72]">{content.heading || content.name || content.title}</strong><p className="mt-1 text-xs">{content.body || content.description || content.price}</p></div></div>;
    if (['callout', 'testimonial', 'merge-tag'].includes(block.type)) return <div className="rounded border-l-4 border-[#0F3A72] bg-blue-50 p-3 text-sm"><strong>{content.heading || content.title || content.author}</strong><p className="mt-1">{content.body || content.quote || content.text}</p></div>;
    if (block.type === 'header' || block.type === 'footer') return <div className="rounded bg-slate-100 p-3 text-center text-xs">{block.type === 'header' ? content.navigation : `${content.company} · ${content.address}`}</div>;
    return null;
  };

  const renderBlock = (block: EmailBlock, index: number, siblings: EmailBlock[]) => {
    const selected = selectedBlockId === block.id;
    const content = block.content;
    const styles = block.styles;
    const alignClass = content.align === 'right' ? 'justify-end' : content.align === 'center' ? 'justify-center' : 'justify-start';
    const layoutState = block.type === 'columns' ? normalizeEmailLayout(block) : null;
    const tableRows: string[][] = block.type === 'data-table' && Array.isArray(content.rows) ? content.rows : [];
    const tableColumnCount = Math.max(1, ...tableRows.map(row => row.length));
    const updateTableRows = (nextRows: string[][]) => onUpdateBlockContent(block.id, { ...content, rows: nextRows });
    const updateTableCell = (rowIndex: number, cellIndex: number, value: string) => updateTableRows(tableRows.map((row, index) => index === rowIndex ? Array.from({ length: tableColumnCount }, (_, columnIndex) => columnIndex === cellIndex ? value : row[columnIndex] || '') : Array.from({ length: tableColumnCount }, (_, columnIndex) => row[columnIndex] || '')));
    const addTableRow = () => updateTableRows([...tableRows, Array.from({ length: tableColumnCount }, () => '')]);
    const addTableColumn = () => updateTableRows((tableRows.length ? tableRows : [[]]).map(row => [...row, '']));
    const removeTableRow = (rowIndex: number) => { if (tableRows.length > 1) updateTableRows(tableRows.filter((_, index) => index !== rowIndex)); };
    const removeTableColumn = (columnIndex: number) => { if (tableColumnCount > 1) updateTableRows(tableRows.map(row => row.filter((_, index) => index !== columnIndex))); };

    return <div key={block.id} onClick={event => { event.stopPropagation(); onSelectBlock(block.id); }} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-ft-email-block-id') || (block.type === 'section' && event.dataTransfer.types.includes('application/x-ft-email-block'))) { event.preventDefault(); event.dataTransfer.dropEffect = block.type === 'section' ? 'move' : 'move'; } }} onDrop={event => dropInto(event, block)} className={`group relative rounded-xl transition ${selected ? 'outline outline-2 outline-blue-500 bg-blue-50/5' : 'hover:outline hover:outline-1 hover:outline-slate-300'} ${block.visible ? '' : 'opacity-40'}`} style={{ marginTop: styles.marginTop ?? 10, marginBottom: styles.marginBottom ?? 10 }}>
      <div className="absolute -top-3 left-3 z-20 hidden rounded bg-blue-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white group-hover:block">{TYPE_NAMES[block.type] || block.type}</div>
      <div className="absolute -top-4 right-3 z-30 hidden items-center gap-1 rounded-xl border bg-white p-1 shadow-lg group-hover:flex">
        <button type="button" draggable onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-ft-email-block-id', block.id); event.dataTransfer.effectAllowed = 'move'; }} className="cursor-grab rounded p-1 hover:bg-slate-100" title="Kéo block"><GripVertical className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={index === 0} onClick={event => { event.stopPropagation(); onMoveBlock(block.id, 'up'); }} className="rounded p-1 disabled:opacity-20"><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={index === siblings.length - 1} onClick={event => { event.stopPropagation(); onMoveBlock(block.id, 'down'); }} className="rounded p-1 disabled:opacity-20"><ArrowDown className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={event => { event.stopPropagation(); onDuplicateBlock(block.id); }} className="rounded p-1"><Copy className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={event => { event.stopPropagation(); onToggleVisibility(block.id); }} className="rounded p-1">{block.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
        <button type="button" onClick={event => { event.stopPropagation(); if (confirm('Bạn có chắc muốn xóa khối này?')) onDeleteBlock(block.id); }} className="rounded p-1 text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div>
        {block.type === 'logo' && <div className={`flex ${alignClass}`}>{content.url ? <img src={content.url} alt={content.alt || 'Logo'} style={{ width: Number(content.width) || 120, height: content.height ? Number(content.height) : 'auto' }} className="max-w-full object-contain" /> : <div className="w-full rounded border border-dashed bg-slate-50 p-4 text-center text-xs text-slate-400">Chưa chọn ảnh logo</div>}</div>}
        {block.type === 'heading' && <div contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập tiêu đề…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => onSelectBlock(block.id)} onBlur={event => onUpdateBlockContent(block.id, { ...content, text: event.currentTarget.textContent || '' })} style={{ textAlign: content.align || 'left', color: content.color || '#0F3A72', fontSize: `${content.fontSize || 20}px`, fontWeight: content.bold === false ? 400 : 700 }} className="min-h-8 rounded font-sans leading-snug outline-none focus:bg-slate-50">{editableText(content.text || '', ['Nhấp để sửa tiêu đề', 'Nhấp để sửa tiêu đề mới'])}</div>}
        {block.type === 'paragraph' && <div>{selected && <BlockToolbar onInsertVariableClick={onOpenVariablePicker} onAlignChange={align => onUpdateBlockContent(block.id, { ...content, align })} onFontSizeChange={size => applySelectionFontSize(block, size)} onTextColorChange={color => applySelectionTextColor(block, color)} activeFontSize={content.fontSize || 15} activeTextColor={content.color || emailSettings.textColor || '#1E293B'} activeAlign={content.align || 'left'} />}<div key="editor" ref={element => { editableRefs.current[block.id] = element; }} contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập nội dung…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => saveSelection(block.id)} onKeyUp={() => saveSelection(block.id)} onSelect={() => saveSelection(block.id)} onBlur={event => updateHtml(block, event.currentTarget)} style={{ textAlign: content.align || 'left', fontSize: `${content.fontSize || 15}px`, lineHeight: content.lineHeight || 1.6, color: content.color || undefined }} className="min-h-10 rounded-lg font-sans outline-none focus:bg-slate-50" dangerouslySetInnerHTML={{ __html: editableHtml(content.html || '') }} /></div>}
        {block.type === 'icon-text' && (() => {
          const IconComponent = getEmailLucideIcon(content.iconName || 'CircleCheck');
          const verticalClass = content.verticalAlign === 'top' ? 'items-start' : content.verticalAlign === 'bottom' ? 'items-end' : 'items-center';
          return <div className={`flex ${alignClass}`}><div className={`inline-flex max-w-full ${verticalClass}`} style={{ gap: Number(content.gap) || 0, color: content.color || undefined, fontSize: `${Number(content.fontSize) || 15}px`, lineHeight: 1.45 }}>
            {content.iconSource === 'upload' && content.iconUrl ? <img src={content.iconUrl} alt="" style={{ width: Number(content.iconSize) || 24, height: Number(content.iconSize) || 24 }} className="shrink-0 object-contain" /> : IconComponent ? <IconComponent size={Number(content.iconSize) || 24} color={content.iconColor || '#1473D1'} strokeWidth={2} className="shrink-0" /> : null}
            <span contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập nội dung minh họa…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => onSelectBlock(block.id)} onBlur={event => onUpdateBlockContent(block.id, { ...content, text: event.currentTarget.textContent || '' })} className="min-w-0 outline-none focus:bg-slate-50">{editableText(content.text || '', ['Nhấp để sửa nội dung minh họa', 'Nội dung minh họa cùng dòng'])}</span>
          </div></div>;
        })()}
        {block.type === 'image' && <div className="space-y-2">{selected && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-[10px] font-bold text-blue-800"><input ref={element => { imageInputRefs.current[block.id] = element; }} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) uploadImage(block, file); event.currentTarget.value = ''; }} /><button type="button" onClick={() => imageInputRefs.current[block.id]?.click()} className="inline-flex items-center gap-1 rounded bg-white px-2 py-1.5 shadow"><ImagePlus className="h-3.5 w-3.5" />Tải ảnh</button><button type="button" onClick={() => pasteImageUrl(block)} className="inline-flex items-center gap-1 rounded bg-white px-2 py-1.5 shadow"><Link className="h-3.5 w-3.5" />Dán URL</button><span className="text-slate-500">hoặc kéo ảnh vào khung</span></div>}<div className={`flex ${alignClass}`} onDragOver={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); } }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); uploadImage(block, event.dataTransfer.files[0]); } }}>{content.url ? <img src={content.url} alt={content.alt || 'Banner'} onLoad={event => { if (!content.naturalRatio) { const ratio = event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight); const width = Number(content.width) || Math.min(event.currentTarget.naturalWidth, 600); onUpdateBlockContent(block.id, { ...content, width, height: content.height || Math.round(width / ratio), naturalRatio: ratio, aspectLocked: content.aspectLocked !== false }); } }} style={{ width: Number(content.width) || 600, height: content.height ? Number(content.height) : 'auto', borderRadius: Number(content.borderRadius) || 0 }} className="max-w-full object-cover" /> : <button type="button" onClick={() => imageInputRefs.current[block.id]?.click()} className="w-full rounded-xl border border-dashed bg-slate-50 p-8 text-xs font-bold text-slate-500">Chọn hoặc kéo thả ảnh vào đây</button>}</div></div>}
        {(block.type === 'bullet-list' || block.type === 'number-list') && (block.type === 'number-list' ? <ol className="ml-5 list-decimal space-y-1" style={{ fontSize: content.fontSize || 15, color: content.color || undefined }}>{(content.items || []).map((item: string, itemIndex: number) => <li key={itemIndex} dangerouslySetInnerHTML={{ __html: item }} />)}</ol> : <ul className="ml-5 list-disc space-y-1" style={{ fontSize: content.fontSize || 15, color: content.color || undefined }}>{(content.items || []).map((item: string, itemIndex: number) => <li key={itemIndex} dangerouslySetInnerHTML={{ __html: item }} />)}</ul>)}
        {block.type === 'button' && <div className={`flex ${alignClass}`}><div style={{ background: content.bg || '#1473d1', color: content.color || '#fff', borderRadius: content.radius ?? 8, width: content.width === 'full' ? '100%' : 'auto', minWidth: content.minWidth ? `${content.minWidth}px` : undefined, fontSize: content.fontSize || 15, padding: `${content.paddingY ?? 12}px ${content.paddingX ?? 24}px` }} className="text-center font-bold">{content.text || 'Nút CTA'}</div></div>}
        {(block.type === 'button-group' || block.type === 'button-group-3') && <div className={`flex flex-nowrap ${alignClass}`} style={{ gap: content.gap ?? 12 }}>{(content.buttons || [content.btn1, content.btn2].filter(Boolean)).map((button: any, buttonIndex: number) => <div key={buttonIndex} style={{ background: button.bg || '#0F3A72', color: button.color || '#fff', borderRadius: button.radius ?? 8, fontSize: button.fontSize ?? 14, padding: `${button.paddingY ?? 11}px ${button.paddingX ?? 18}px`, minWidth: button.minWidth ? `${button.minWidth}px` : undefined }} className="text-center font-bold">{button.text}</div>)}</div>}
        {block.type === 'highlight-box' && <div>{selected && <BlockToolbar onInsertVariableClick={onOpenVariablePicker} onFontSizeChange={size => applySelectionFontSize(block, size)} onTextColorChange={color => applySelectionTextColor(block, color)} activeFontSize={content.fontSize || 14} activeTextColor={content.color || emailSettings.textColor || '#1E293B'} />}<div key="editor" ref={element => { editableRefs.current[block.id] = element; }} contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập nội dung…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => saveSelection(block.id)} onKeyUp={() => saveSelection(block.id)} onSelect={() => saveSelection(block.id)} onBlur={event => updateHtml(block, event.currentTarget)} style={{ background: content.bg || '#eef6ff', borderLeft: `4px solid ${content.borderColor || '#1473d1'}`, padding: content.padding ?? 16, fontSize: content.fontSize || 14, color: content.color || undefined }} className="min-h-10 rounded-r outline-none" dangerouslySetInnerHTML={{ __html: editableHtml(content.html || '') }} /></div>}
        {block.type === 'signature' && <div>{selected && <BlockToolbar onInsertVariableClick={onOpenVariablePicker} onFontSizeChange={size => applySelectionFontSize(block, size)} onTextColorChange={color => applySelectionTextColor(block, color)} activeFontSize={content.fontSize || 14} activeTextColor={content.color || emailSettings.textColor || '#1E293B'} />}<div key="editor" ref={element => { editableRefs.current[block.id] = element; }} contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập nội dung…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => saveSelection(block.id)} onKeyUp={() => saveSelection(block.id)} onSelect={() => saveSelection(block.id)} onBlur={event => updateHtml(block, event.currentTarget)} style={{ fontSize: content.fontSize || 14, lineHeight: content.lineHeight || 1.5, color: content.color || undefined }} className="min-h-10 rounded p-1 outline-none" dangerouslySetInnerHTML={{ __html: editableHtml(content.html || '') }} /></div>}
        {block.type === 'divider' && <div style={{ borderTop: `${styles.thickness ?? 1}px ${styles.borderStyle || 'solid'} ${styles.color || '#e2e8f0'}` }} />}
        {block.type === 'spacer' && <div style={{ height: styles.height ?? 20 }} className="flex items-center justify-center border-y border-dashed text-[10px] text-slate-300">Khoảng trắng {styles.height ?? 20}px</div>}
        {block.type === 'social-links' && <div className={`flex ${alignClass} gap-3`}>{(content.links || []).filter((item: any) => item.visible !== false).map((item: any, itemIndex: number) => <span key={itemIndex} className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-blue-700">{item.label}</span>)}</div>}
        {block.type === 'data-table' && <div className="overflow-x-auto">
          <div className="mb-2 flex items-center gap-2">
            <div contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập tiêu đề bảng…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => onSelectBlock(block.id)} onBlur={event => onUpdateBlockContent(block.id, { ...content, heading: event.currentTarget.textContent || '' })} className="min-h-7 flex-1 rounded px-1 text-base font-bold text-[#0F3A72] outline-none focus:bg-blue-50">{editableText(content.heading || '', ['Nhấp để thêm tiêu đề bảng'])}</div>
            {selected && <><button type="button" onClick={event => { event.stopPropagation(); addTableRow(); }} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[9px] font-bold text-blue-700"><Plus className="h-3 w-3" />Dòng</button><button type="button" onClick={event => { event.stopPropagation(); addTableColumn(); }} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[9px] font-bold text-blue-700"><Plus className="h-3 w-3" />Cột</button></>}
          </div>
          {selected && <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${tableColumnCount}, minmax(80px, 1fr)) 28px` }}>{Array.from({ length: tableColumnCount }, (_, columnIndex) => <button key={columnIndex} type="button" disabled={tableColumnCount <= 1} onClick={event => { event.stopPropagation(); removeTableColumn(columnIndex); }} className="inline-flex items-center justify-center gap-1 rounded bg-slate-100 py-1 text-[8px] font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-2.5 w-2.5" />Cột {columnIndex + 1}</button>)}<span /></div>}
          <table className="w-full border-collapse text-left text-xs"><tbody>{tableRows.map((row, rowIndex) => <tr key={rowIndex}>{Array.from({ length: tableColumnCount }, (_, cellIndex) => rowIndex === 0 ? <th key={cellIndex} className="border border-slate-300 bg-slate-100 p-0 font-bold"><div contentEditable suppressContentEditableWarning onFocus={() => onSelectBlock(block.id)} onMouseUp={() => onSelectBlock(block.id)} onBlur={event => updateTableCell(rowIndex, cellIndex, event.currentTarget.textContent || '')} className="min-h-9 px-2 py-2 outline-none focus:bg-blue-50">{row[cellIndex] || ''}</div></th> : <td key={cellIndex} className="border border-slate-300 p-0"><div contentEditable suppressContentEditableWarning onFocus={() => onSelectBlock(block.id)} onMouseUp={() => onSelectBlock(block.id)} onBlur={event => updateTableCell(rowIndex, cellIndex, event.currentTarget.textContent || '')} className="min-h-9 px-2 py-2 outline-none focus:bg-blue-50">{row[cellIndex] || ''}</div></td>)}{selected && <td className="w-7 border-y border-r border-slate-200 bg-white p-0 text-center"><button type="button" disabled={tableRows.length <= 1} onClick={event => { event.stopPropagation(); removeTableRow(rowIndex); }} className="rounded p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-25" title={`Xóa dòng ${rowIndex + 1}`}><Trash2 className="h-3.5 w-3.5" /></button></td>}</tr>)}</tbody></table>
        </div>}        {block.type === 'section' && <div onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => dropInto(event, block)} style={{ background: content.bg || '#f8fafc', padding: content.padding ?? 20 }} className="rounded-lg border border-dashed border-slate-300"><div contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập tiêu đề Section…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => onSelectBlock(block.id)} onBlur={event => onUpdateBlockContent(block.id, { ...content, heading: event.currentTarget.textContent || '' })} className="min-h-6 font-bold text-[#0F3A72] outline-none">{editableText(content.heading || '', ['Nội dung section'])}</div><div contentEditable suppressContentEditableWarning data-ft-placeholder="true" data-placeholder="Nhập mô tả ngắn…" onFocus={() => onSelectBlock(block.id)} onMouseUp={() => onSelectBlock(block.id)} onBlur={event => onUpdateBlockContent(block.id, { ...content, body: event.currentTarget.textContent || '' })} className="mt-1 min-h-5 text-xs text-slate-500 outline-none">{editableText(content.body || '', ['Gom phần nội dung có cùng ngữ cảnh.'])}</div><div className="mt-3 min-h-16 space-y-2">{(block.children || []).map((child, childIndex, siblings) => renderBlock(child, childIndex, siblings))}{!(block.children || []).length && <div className="flex min-h-16 items-center justify-center rounded border border-dashed border-blue-200 bg-white/70 text-[10px] font-bold text-blue-600">Thả block vào Section</div>}</div><button type="button" onClick={event => { event.stopPropagation(); onAddBlock('paragraph', block.id); }} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-blue-700"><Plus className="h-3.5 w-3.5" />Thêm đoạn văn</button></div>}
        {block.type === 'columns' && layoutState && <div className="space-y-2">
          <div className={`flex items-center justify-center gap-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}><span className="mr-1 text-[9px] font-bold text-slate-400">Số cột</span>{[2, 3, 4].map(count => <button key={count} type="button" onClick={event => { event.stopPropagation(); setLayoutColumnCount(block, count); }} className={`rounded-lg border px-2 py-1 text-[9px] font-black ${layoutState.layout.length === count ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>{count}</button>)}</div>
          <div className="grid items-stretch" style={{ gridTemplateColumns: layoutState.layout.map(column => `minmax(0, ${column.width}fr)`).join(' '), columnGap: content.horizontalGap ?? 12 }}>
            {layoutState.layout.map((layoutColumn, columnIndex) => <div key={layoutColumn.id} className="grid h-full min-w-0" style={{ gridTemplateRows: `repeat(${layoutColumn.cells.length}, minmax(0, 1fr))`, rowGap: content.verticalGap ?? 12 }}>
              {layoutColumn.cells.map((cell, cellIndex) => { const slotIndex = getLayoutSlotIndex(layoutState.layout, columnIndex, cellIndex); const slot = layoutState.slots[slotIndex] || []; return <div key={cell.id} onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => dropInto(event, block, slotIndex)} className="group/cell relative flex min-w-0 flex-col transition hover:outline hover:outline-2 hover:outline-blue-300" style={{ minHeight: cell.minHeight, justifyContent: cell.verticalAlign === 'middle' ? 'center' : cell.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start', backgroundColor: cell.background, color: cell.color || undefined, padding: cell.padding, border: cell.borderWidth ? `${cell.borderWidth}px solid ${cell.borderColor}` : 'none', borderRadius: cell.borderRadius }}>
                <div className="min-w-0">{slot.map((child, childIndex, siblings) => renderBlock(child, childIndex, siblings))}</div>
                {!slot.length && <div className="flex min-h-12 flex-1 items-center justify-center rounded border border-dashed border-blue-200 bg-white/50 px-2 text-center text-[9px] font-bold text-slate-400">Thả block vào ô này</div>}
                <button type="button" onClick={event => { event.stopPropagation(); onAddBlock('paragraph', block.id, slotIndex); }} className="mt-1 inline-flex items-center justify-center gap-1 self-start rounded px-1.5 py-1 text-[9px] font-bold text-blue-700 opacity-70 hover:bg-blue-50 hover:opacity-100"><Plus className="h-3 w-3" />Thêm block</button>
              </div>; })}
              {layoutColumn.cells.length < 4 && <button type="button" onClick={event => { event.stopPropagation(); onUpdateBlock(block.id, addEmailLayoutCell(block, columnIndex)); }} className="mt-1 inline-flex items-center justify-center gap-1 rounded border border-dashed border-slate-300 py-1 text-[8px] font-bold text-slate-500 opacity-0 transition hover:border-blue-300 hover:text-blue-700 group-hover:opacity-100"><Plus className="h-3 w-3" />Chia thêm ô dọc</button>}
            </div>)}
          </div>
        </div>}        {!['logo','heading','paragraph','image','icon-text','bullet-list','number-list','button','button-group','button-group-3','highlight-box','signature','divider','spacer','social-links','data-table','section','columns'].includes(block.type) && renderSimplePreview(block)}
      </div>
    </div>;
  };

  const rootDrop = (event: React.DragEvent) => {
    event.preventDefault(); setRootDragOver(false);
    const type = event.dataTransfer.getData('application/x-ft-email-block') as BlockType;
    if (type && EMAIL_BLOCK_REGISTRY[type]) onAddBlock(type);
  };
  const filteredDefinitions = BLOCK_CATEGORIES.map(category => ({ ...category, items: Object.values(EMAIL_BLOCK_REGISTRY).filter(item => item.category === category.id && `${item.label} ${item.description}`.toLowerCase().includes(blockQuery.toLowerCase())) })).filter(category => category.items.length);

  return <div className="flex w-full flex-col items-center px-4 py-6 md:px-8">
    <style>{'::highlight(ft-email-selection){background:#2563eb;color:#ffffff;} [data-ft-placeholder="true"]:empty::before{content:attr(data-placeholder);color:#94a3b8;font-weight:400;pointer-events:none;}'}</style>
    <div ref={selectionOverlayRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[9999]" />
    <div className="flex w-full max-w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" style={{ maxWidth: emailSettings.maxWidth + 72 }}>
      <div className="flex items-center justify-between border-b px-4 py-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email canvas</p><p className="mt-0.5 text-xs font-bold text-slate-700">Kéo block từ trái hoặc thả trực tiếp vào từng Section/ô</p></div><span className="rounded border bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-500">{emailSettings.maxWidth}px</span></div>
      <div onClick={() => onSelectBlock('')} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-ft-email-block')) { event.preventDefault(); setRootDragOver(true); } }} onDragLeave={event => { if (event.currentTarget === event.target) setRootDragOver(false); }} onDrop={rootDrop} className="relative flex min-h-[520px] justify-center bg-[#f5f6f8] p-5 md:p-8">
        {rootDragOver && <div className="pointer-events-none absolute inset-5 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/90 text-sm font-black text-blue-700">Thả block vào cuối email</div>}
        <div className="w-full border bg-white shadow-sm" style={{ maxWidth: emailSettings.maxWidth, backgroundColor: emailSettings.contentBg, borderRadius: emailSettings.borderRadius, fontFamily: emailSettings.fontFamily || 'Arial', color: emailSettings.textColor || '#1e293b' }}><div style={{ padding: emailSettings.contentPadding }} >{blocks.map((block, index, siblings) => renderBlock(block, index, siblings))}<div className="relative flex justify-center border-t border-dashed pt-5"><button type="button" onClick={event => { event.stopPropagation(); setIsInserterOpen(open => !open); }} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-[#0F3A72] shadow"><Plus className="h-4 w-4" />Thêm khối nội dung</button>{isInserterOpen && <div className="absolute bottom-12 z-50 w-[min(520px,calc(100vw-48px))] rounded-xl border bg-white p-3 shadow-2xl" onClick={event => event.stopPropagation()}><input autoFocus value={blockQuery} onChange={event => setBlockQuery(event.target.value)} placeholder="Tìm block…" className="mb-3 w-full rounded-lg border px-3 py-2 text-xs outline-none focus:border-blue-500" /><div className="max-h-72 space-y-3 overflow-y-auto">{filteredDefinitions.map(category => <div key={category.id}><p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">{category.label}</p><div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{category.items.map(item => <button key={item.id} type="button" onClick={() => { onAddBlock(item.id); setIsInserterOpen(false); setBlockQuery(''); }} className="rounded-lg border px-2 py-2 text-left text-[10px] font-bold hover:border-blue-300 hover:bg-blue-50">{item.label}</button>)}</div></div>)}</div></div>}</div></div></div>
      </div>
    </div>
  </div>;
});

export default EmailCanvas;

function findBlock(blocks: EmailBlock[], id: string): EmailBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findBlock(block.children || [], id);
    if (child) return child;
    for (const column of block.columns || []) { const nested = findBlock(column, id); if (nested) return nested; }
  }
}