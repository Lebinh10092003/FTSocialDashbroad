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
