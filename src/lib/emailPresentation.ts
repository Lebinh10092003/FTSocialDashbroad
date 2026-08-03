import { EmailBlock, EmailLayoutCell, EmailSettings } from '../types/emailBuilder';

const parseCssColor = (value: string): [number, number, number] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex.slice(0, 6);
    return [0, 2, 4].map(index => Number.parseInt(expanded.slice(index, index + 2), 16)) as [number, number, number];
  }

  const rgb = normalized.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) return null;
  return rgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Number(channel)))) as [number, number, number];
};

export const isDarkEmailColor = (value: string): boolean => {
  const rgb = parseCssColor(value);
  if (!rgb) return false;
  const [red, green, blue] = rgb.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.32;
};

/**
 * Legacy imported templates often contain a dark container background but no
 * explicit container text colour. Use the same contrast fallback in the React
 * canvas and in generated email HTML so old templates remain readable.
 */
export const resolveEmailContainerTextColor = (
  background: string,
  explicitColor?: string,
  inheritedColor?: string,
  defaultColor = '#1e293b',
): string => {
  if (String(explicitColor || '').trim()) return String(explicitColor).trim();
  if (isDarkEmailColor(background)) return '#ffffff';
  return String(inheritedColor || '').trim() || defaultColor;
};

/** Convert CSS line-height values into the unitless value used by email blocks. */
export const parseImportedLineHeight = (value: string, fontSize: number, fallback = 1.6): number => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'normal') return fallback;

  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (normalized.endsWith('%')) return Math.max(1, Math.min(3, numeric / 100));
  if (/(?:px|pt|em|rem)$/.test(normalized)) {
    const pixels = normalized.endsWith('pt') ? numeric * 4 / 3
      : normalized.endsWith('rem') || normalized.endsWith('em') ? numeric * fontSize
        : numeric;
    return Math.max(1, Math.min(3, pixels / Math.max(1, fontSize)));
  }
  return Math.max(1, Math.min(3, numeric));
};

/**
 * Importer v1 treated pixel line-height values as unitless and clamped them to
 * 3. Render those legacy records with a safe email ratio without rewriting or
 * recreating the user's template. New imports carry lineHeightVersion 2.
 */
export const resolveEmailLineHeight = (value: unknown, version?: unknown, fallback = 1.6): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (!version && numeric >= 2.95) return fallback;
  return Math.max(1, Math.min(3, numeric));
};

export interface EmailBlockPresentation {
  marginTop: number;
  marginBottom: number;
  textColor: string;
  backgroundColor: string;
  align: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: string | number;
  fontStyle: string;
  letterSpacing: number;
  textTransform: string;
  padding: number;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  boxShadow: string;
  overflow: string;
  tableCellPadding: number;
  tableFontSize: number;
  tableLineHeight: number;
  tableHeaderBackground: string;
}

/** Canonical visual values consumed by both the interactive canvas and email HTML. */
export const getEmailBlockPresentation = (
  block: EmailBlock,
  settings: EmailSettings,
  inheritedTextColor?: string,
): EmailBlockPresentation => {
  const content = block.content || {};
  const styles = block.styles || {};
  const defaultTextColor = settings.textColor || '#1e293b';
  const backgroundColor = content.bg || (block.type === 'section' ? '#f8fafc' : settings.contentBg || '#ffffff');
  const sectionTextColor = resolveEmailContainerTextColor(backgroundColor, content.color, inheritedTextColor, defaultTextColor);
  const textColor = block.type === 'section'
    ? sectionTextColor
    : String(content.color || inheritedTextColor || (block.type === 'heading' ? '#0F3A72' : defaultTextColor));

  return {
    marginTop: Number(styles.marginTop ?? (block.type === 'divider' ? 0 : 10)),
    marginBottom: Number(styles.marginBottom ?? (block.type === 'divider' ? 0 : 10)),
    textColor,
    backgroundColor,
    align: content.align || 'left',
    fontSize: Number(content.fontSize || (block.type === 'heading' ? 20 : block.type === 'data-table' ? 13 : 15)),
    lineHeight: block.type === 'heading' ? 1.3 : resolveEmailLineHeight(content.lineHeight, content.lineHeightVersion),
    fontWeight: block.type === 'heading' ? (content.bold === false ? 400 : 700) : (content.fontWeight || 'normal'),
    fontStyle: content.fontStyle || 'normal',
    letterSpacing: Number(content.letterSpacing) || 0,
    textTransform: content.textTransform || 'none',
    padding: Number(content.padding ?? 24),
    borderColor: content.borderColor || '#e2e8f0',
    borderWidth: Number(content.borderWidth ?? 1),
    borderRadius: Number(content.borderRadius ?? 0),
    boxShadow: content.boxShadow || 'none',
    overflow: content.overflow || 'visible',
    tableCellPadding: 10,
    tableFontSize: 13,
    tableLineHeight: 1.4,
    tableHeaderBackground: '#f1f5f9',
  };
};

export interface EmailLayoutCellPresentation {
  backgroundColor: string;
  textColor: string;
  padding: number;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  verticalAlign: string;
}

export const getEmailLayoutCellPresentation = (
  cell: EmailLayoutCell,
  settings: EmailSettings,
  inheritedTextColor?: string,
): EmailLayoutCellPresentation => ({
  backgroundColor: cell.background || '#ffffff',
  textColor: resolveEmailContainerTextColor(cell.background || '#ffffff', cell.color, inheritedTextColor, settings.textColor || '#1e293b'),
  padding: Number(cell.padding) || 0,
  borderColor: cell.borderColor || '#e2e8f0',
  borderWidth: Number(cell.borderWidth) || 0,
  borderRadius: Number(cell.borderRadius) || 0,
  verticalAlign: cell.verticalAlign || 'top',
});
