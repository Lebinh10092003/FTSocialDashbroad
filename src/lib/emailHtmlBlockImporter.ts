import { EmailBlock, EmailLayoutCell, EmailLayoutColumn } from '../types/emailBuilder';
import { createLayoutColumn } from './emailLayout';
import { sanitizeHtml } from './emailSanitizer';

const HEADING_SIZES: Record<string, number> = { h1: 30, h2: 24, h3: 20, h4: 18, h5: 16, h6: 14 };
const CONTAINER_TAGS = new Set(['body', 'main', 'article', 'section', 'header', 'footer', 'div', 'center', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th']);

const px = (value: string | null | undefined, fallback = 0) => {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const meaningful = (value: string | null | undefined) => Boolean(String(value || '').replace(/\u00a0/g, ' ').trim());

export interface EmailHtmlBlockImportResult {
  blocks: EmailBlock[];
  customBlockCount: number;
}

export function importHtmlToEmailBlocks(html: string, seed = Date.now()): EmailHtmlBlockImportResult {
  const documentNode = new DOMParser().parseFromString(html || '', 'text/html');
  let sequence = 0;
  let customBlockCount = 0;
  const nextId = (type: string) => `${type}-${seed}-${sequence++}`;

  const inheritedStyle = (element: Element, property: keyof CSSStyleDeclaration): string => {
    let current: Element | null = element;
    while (current && current !== documentNode.documentElement) {
      const value = String((current as HTMLElement).style?.[property] || '').trim();
      if (value && value !== 'inherit' && value !== 'initial' && value !== 'unset') return value;
      current = current.parentElement;
    }
    return '';
  };

  const blockStyles = (element: Element, defaultMargin = 10) => ({
    marginTop: clamp(px((element as HTMLElement).style.marginTop, defaultMargin), 0, 120),
    marginBottom: clamp(px((element as HTMLElement).style.marginBottom, defaultMargin), 0, 120),
  });

  const alignment = (element: Element) => {
    const raw = inheritedStyle(element, 'textAlign') || element.getAttribute('align') || 'left';
    return ['center', 'right', 'justify'].includes(raw.toLowerCase()) ? raw.toLowerCase() : 'left';
  };

  const textColor = (element: Element, fallback = '#1e293b') => inheritedStyle(element, 'color') || element.getAttribute('color') || fallback;
  const background = (element: Element, fallback = '#ffffff') => {
    const value = inheritedStyle(element, 'backgroundColor') || element.getAttribute('bgcolor') || '';
    return !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)' ? fallback : value;
  };

  const paragraphBlock = (htmlValue: string, source: Element): EmailBlock => ({
    id: nextId('paragraph'),
    type: 'paragraph',
    content: {
      html: sanitizeHtml(htmlValue),
      align: alignment(source),
      fontSize: clamp(px(inheritedStyle(source, 'fontSize'), 15), 9, 72),
      lineHeight: clamp(Number.parseFloat(inheritedStyle(source, 'lineHeight')) || 1.6, 1, 3),
      color: textColor(source),
    },
    styles: blockStyles(source),
    visible: true,
  });

  const customBlock = (source: Element): EmailBlock => {
    customBlockCount += 1;
    return {
      id: nextId('custom-html'),
      type: 'custom-html',
      content: { variant: 'style-1', html: source.outerHTML },
      styles: blockStyles(source),
      visible: true,
    };
  };

  const imageBlock = (image: HTMLImageElement, link = ''): EmailBlock => {
    const rawWidth = image.getAttribute('width') || image.style.width;
    const rawHeight = image.getAttribute('height') || image.style.height;
    const width = /%/.test(rawWidth || '') ? 600 : clamp(px(rawWidth, image.naturalWidth || 600), 1, 1200);
    const height = /%|auto/.test(rawHeight || '') ? '' : px(rawHeight, 0) || '';
    const looksLikeLogo = /logo|thương hiệu|brand/i.test(`${image.alt} ${image.className} ${image.id}`) || width <= 200;
    return {
      id: nextId(looksLikeLogo ? 'logo' : 'image'),
      type: looksLikeLogo ? 'logo' : 'image',
      content: looksLikeLogo ? {
        url: image.getAttribute('src') || '', alt: image.alt || 'Logo', width, height, align: alignment(image), link,
      } : {
        url: image.getAttribute('src') || '', alt: image.alt || 'Hình ảnh', width, height, aspectLocked: true,
        naturalRatio: null, align: alignment(image), borderRadius: clamp(px(image.style.borderRadius, 0), 0, 80), link,
      },
      styles: blockStyles(image),
      visible: true,
    };
  };

  const headingBlock = (element: HTMLElement): EmailBlock => {
    const level = element.tagName.toLowerCase();
    const fontWeight = inheritedStyle(element, 'fontWeight');
    return {
      id: nextId('heading'),
      type: 'heading',
      content: {
        text: element.textContent?.trim() || '',
        html: sanitizeHtml(element.innerHTML),
        level,
        fontSize: clamp(px(inheritedStyle(element, 'fontSize'), HEADING_SIZES[level] || 20), 10, 72),
        color: textColor(element, '#0f3a72'),
        bold: !fontWeight || fontWeight === 'bold' || Number(fontWeight) >= 600,
        align: alignment(element),
      },
      styles: blockStyles(element, 12),
      visible: true,
    };
  };

  const buttonBlock = (anchor: HTMLAnchorElement): EmailBlock => ({
    id: nextId('button'),
    type: 'button',
    content: {
      text: anchor.textContent?.trim() || 'Mở liên kết',
      html: sanitizeHtml(anchor.innerHTML),
      link: anchor.getAttribute('href') || '',
      bg: background(anchor, '#1473d1'),
      color: textColor(anchor, '#ffffff'),
      radius: clamp(px(anchor.style.borderRadius, 8), 0, 80),
      align: alignment(anchor),
      width: /100%/.test(anchor.style.width) ? 'full' : 'auto',
      fontSize: clamp(px(inheritedStyle(anchor, 'fontSize'), 15), 9, 40),
      paddingX: clamp(px(anchor.style.paddingLeft || anchor.style.padding, 24), 4, 80),
      paddingY: clamp(px(anchor.style.paddingTop || anchor.style.padding, 12), 4, 48),
      minWidth: clamp(px(anchor.style.minWidth, 0), 0, 800),
    },
    styles: blockStyles(anchor),
    visible: true,
  });

  const looksLikeButton = (anchor: HTMLAnchorElement) => {
    const signal = `${anchor.className} ${anchor.id}`;
    return /button|btn|cta/i.test(signal)
      || Boolean(anchor.style.backgroundColor)
      || ['inline-block', 'block', 'table'].includes(anchor.style.display);
  };

  const parseChildren = (parent: Element, depth = 0): EmailBlock[] => {
    if (depth > 20) return [customBlock(parent)];
    const result: EmailBlock[] = [];
    let pendingText = '';
    const flushText = () => {
      if (meaningful(pendingText)) result.push(paragraphBlock(pendingText.trim(), parent));
      pendingText = '';
    };
    parent.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (meaningful(node.textContent)) pendingText += `${node.textContent} `;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      flushText();
      result.push(...convertElement(node as HTMLElement, depth + 1));
    });
    flushText();
    return result;
  };

  const cellPresentation = (cell: HTMLTableCellElement): EmailLayoutCell => {
    const base = createLayoutColumn(0).cells[0];
    const borderWidth = clamp(px(cell.style.borderWidth || cell.style.border, 0), 0, 12);
    return {
      ...base,
      id: nextId('cell'),
      background: background(cell, '#ffffff'),
      color: textColor(cell, ''),
      padding: clamp(px(cell.style.padding, 8), 0, 64),
      borderColor: cell.style.borderColor || '#e2e8f0',
      borderWidth,
      borderRadius: clamp(px(cell.style.borderRadius, 0), 0, 80),
      verticalAlign: ['middle', 'bottom'].includes(cell.getAttribute('valign') || cell.style.verticalAlign) ? (cell.getAttribute('valign') || cell.style.verticalAlign) as 'middle' | 'bottom' : 'top',
    };
  };

  const columnsBlock = (cells: HTMLTableCellElement[], source: HTMLTableElement): EmailBlock => {
    const layoutColumns: EmailLayoutColumn[] = cells.map((cell, index) => {
      const column = createLayoutColumn(index);
      const rawWidth = cell.getAttribute('width') || cell.style.width;
      const width = /%/.test(rawWidth || '') ? Math.max(.25, px(rawWidth, 100 / cells.length) / (100 / cells.length)) : 1;
      return { ...column, id: nextId('column'), width, cells: [cellPresentation(cell)] };
    });
    return {
      id: nextId('columns'),
      type: 'columns',
      content: {
        variant: cells.length === 4 ? 'four' : cells.length === 3 ? 'three' : 'two',
        horizontalGap: 0,
        verticalGap: 0,
        layoutColumns,
      },
      styles: blockStyles(source, 0),
      visible: true,
      columns: cells.map(cell => parseChildren(cell, 1)),
    };
  };

  const dataTableBlock = (table: HTMLTableElement, rows: HTMLTableRowElement[]): EmailBlock => ({
    id: nextId('data-table'),
    type: 'data-table',
    content: {
      variant: 'style-1',
      heading: table.getAttribute('aria-label') || table.querySelector('caption')?.textContent?.trim() || '',
      rows: rows.map(row => Array.from(row.cells).map(cell => cell.textContent?.replace(/\s+/g, ' ').trim() || '')),
    },
    styles: blockStyles(table),
    visible: true,
  });

  const tableBlocks = (table: HTMLTableElement, depth: number): EmailBlock[] => {
    const rows = Array.from(table.rows).filter(row => row.closest('table') === table);
    const rowCells = rows.map(row => Array.from(row.cells));
    const columnCounts = rowCells.map(cells => cells.length).filter(Boolean);
    const consistentColumns = columnCounts.length > 1 && columnCounts.every(count => count === columnCounts[0]);
    const hasHeaderCells = rowCells.some(cells => cells.some(cell => cell.tagName.toLowerCase() === 'th'));
    const nestedTables = Array.from(table.querySelectorAll('table')).filter(nested => nested !== table).length;
    const averageCellLength = rowCells.flat().reduce((total, cell) => total + (cell.textContent?.trim().length || 0), 0) / Math.max(1, rowCells.flat().length);
    const looksLikeData = rows.length >= 2 && consistentColumns && columnCounts[0] >= 2 && columnCounts[0] <= 8
      && nestedTables === 0 && (hasHeaderCells || (table.getAttribute('role') !== 'presentation' && averageCellLength < 180));
    if (looksLikeData) return [dataTableBlock(table, rows)];

    const result: EmailBlock[] = [];
    rows.forEach((row, rowIndex) => {
      const cells = Array.from(row.cells).filter(cell => meaningful(cell.textContent) || cell.querySelector('img, hr, table'));
      if (!cells.length) {
        const height = px(row.getAttribute('height') || row.style.height, 0);
        if (height > 4) result.push({ id: nextId('spacer'), type: 'spacer', content: {}, styles: { height: clamp(height, 4, 160) }, visible: true });
      } else if (cells.length >= 2 && cells.length <= 4) {
        result.push(columnsBlock(cells, table));
      } else {
        cells.forEach(cell => result.push(...convertElement(cell, depth + rowIndex + 1)));
      }
    });
    return result.length ? result : [customBlock(table)];
  };

  const hasContainerPresentation = (element: HTMLElement) => {
    const ownBg = element.style.backgroundColor || element.getAttribute('bgcolor') || '';
    const padding = px(element.style.padding, 0);
    const border = px(element.style.borderWidth || element.style.border, 0);
    const radius = px(element.style.borderRadius, 0);
    return Boolean(ownBg && ownBg !== 'transparent') || padding >= 8 || border > 0 || radius > 0;
  };

  const sectionBlock = (element: HTMLElement, children: EmailBlock[]): EmailBlock => ({
    id: nextId('section'),
    type: 'section',
    content: {
      variant: 'style-1', heading: '', body: '', importedContainer: true,
      bg: background(element, '#ffffff'),
      color: textColor(element, ''),
      padding: clamp(px(element.style.padding, 16), 0, 64),
      borderColor: element.style.borderColor || '#e2e8f0',
      borderWidth: clamp(px(element.style.borderWidth || element.style.border, 0), 0, 12),
      borderRadius: clamp(px(element.style.borderRadius, 0), 0, 80),
    },
    styles: blockStyles(element, 0),
    visible: true,
    children,
  });

  function convertElement(element: HTMLElement, depth = 0): EmailBlock[] {
    const tag = element.tagName.toLowerCase();
    if (!meaningful(element.textContent) && !element.querySelector('img, hr, table') && tag !== 'img' && tag !== 'hr') return [];
    if (/^h[1-6]$/.test(tag)) return [headingBlock(element)];
    if (tag === 'p' || tag === 'address' || tag === 'figcaption') {
      const directElements = Array.from(element.children);
      const onlyChild = directElements.length === 1 && Array.from(element.childNodes).every(node => node.nodeType === Node.ELEMENT_NODE || !meaningful(node.textContent)) ? directElements[0] as HTMLElement : null;
      if (onlyChild?.tagName.toLowerCase() === 'a' || onlyChild?.tagName.toLowerCase() === 'img') return convertElement(onlyChild, depth + 1);
      return [paragraphBlock(element.innerHTML, element)];
    }
    if (tag === 'blockquote') {
      return [{
        id: nextId('highlight-box'), type: 'highlight-box',
        content: { html: sanitizeHtml(element.innerHTML), bg: background(element, '#eef6ff'), borderColor: element.style.borderLeftColor || '#1473d1', padding: clamp(px(element.style.padding, 16), 0, 64), color: textColor(element) },
        styles: blockStyles(element), visible: true,
      }];
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(element.children).filter(child => child.tagName.toLowerCase() === 'li').map(item => sanitizeHtml(item.innerHTML));
      return items.length ? [{ id: nextId(tag === 'ol' ? 'number-list' : 'bullet-list'), type: tag === 'ol' ? 'number-list' : 'bullet-list', content: { items, fontSize: clamp(px(inheritedStyle(element, 'fontSize'), 15), 9, 48), lineHeight: 1.6, color: textColor(element) }, styles: blockStyles(element), visible: true }] : [];
    }
    if (tag === 'img') return [imageBlock(element as HTMLImageElement)];
    if (tag === 'a') {
      const anchor = element as HTMLAnchorElement;
      const image = anchor.querySelector(':scope > img') as HTMLImageElement | null;
      if (image) return [imageBlock(image, anchor.getAttribute('href') || '')];
      return looksLikeButton(anchor) ? [buttonBlock(anchor)] : [paragraphBlock(anchor.outerHTML, anchor)];
    }
    if (tag === 'hr') {
      return [{ id: nextId('divider'), type: 'divider', content: {}, styles: { ...blockStyles(element, 0), thickness: clamp(px(element.style.borderTopWidth || element.getAttribute('size'), 1), 1, 12), color: element.style.borderTopColor || '#e2e8f0', borderStyle: element.style.borderTopStyle || 'solid' }, visible: true }];
    }
    if (tag === 'table') return tableBlocks(element as HTMLTableElement, depth);
    if (tag === 'pre' || tag === 'code' || tag === 'svg' || tag === 'canvas') return [customBlock(element)];

    if (CONTAINER_TAGS.has(tag) || element.children.length) {
      const children = parseChildren(element, depth);
      if (!children.length && meaningful(element.textContent)) return [paragraphBlock(element.innerHTML, element)];
      if (tag !== 'body' && tag !== 'tr' && hasContainerPresentation(element) && children.length) return [sectionBlock(element, children)];
      return children;
    }
    return meaningful(element.textContent) ? [paragraphBlock(element.outerHTML, element)] : [customBlock(element)];
  }

  return { blocks: parseChildren(documentNode.body), customBlockCount };
}
