export interface EmailColorSwatch {
  value: string;
  name: string;
}

export interface ParsedEmailColor {
  r: number;
  g: number;
  b: number;
  hex: string;
  rgb: string;
}

export const EMAIL_COLOR_SWATCHES: EmailColorSwatch[] = [
  { value: '#0F3A72', name: 'Fermat Deep' },
  { value: '#1473D1', name: 'Fermat Blue' },
  { value: '#2563EB', name: 'Xanh dương' },
  { value: '#4F46E5', name: 'Chàm' },
  { value: '#7C3AED', name: 'Tím' },
  { value: '#C026D3', name: 'Hồng tím' },
  { value: '#E11D48', name: 'Đỏ hồng' },
  { value: '#DC2626', name: 'Đỏ' },
  { value: '#EA580C', name: 'Cam đậm' },
  { value: '#F59E0B', name: 'Hổ phách' },
  { value: '#65A30D', name: 'Xanh chanh' },
  { value: '#16A34A', name: 'Xanh lá' },
  { value: '#059669', name: 'Ngọc lục bảo' },
  { value: '#0D9488', name: 'Xanh ngọc' },
  { value: '#0891B2', name: 'Xanh lơ' },
  { value: '#0284C7', name: 'Xanh da trời' },
  { value: '#DBEAFE', name: 'Xanh dương rất nhạt' },
  { value: '#E0E7FF', name: 'Chàm rất nhạt' },
  { value: '#F3E8FF', name: 'Tím rất nhạt' },
  { value: '#FCE7F3', name: 'Hồng rất nhạt' },
  { value: '#FFE4E6', name: 'Đỏ hồng rất nhạt' },
  { value: '#FEE2E2', name: 'Đỏ rất nhạt' },
  { value: '#FFEDD5', name: 'Cam rất nhạt' },
  { value: '#FEF3C7', name: 'Vàng rất nhạt' },
  { value: '#ECFCCB', name: 'Xanh chanh rất nhạt' },
  { value: '#DCFCE7', name: 'Xanh lá rất nhạt' },
  { value: '#D1FAE5', name: 'Ngọc lục bảo rất nhạt' },
  { value: '#CCFBF1', name: 'Xanh ngọc rất nhạt' },
  { value: '#CFFAFE', name: 'Xanh lơ rất nhạt' },
  { value: '#E0F2FE', name: 'Xanh da trời rất nhạt' },
  { value: '#FFFFFF', name: 'Trắng' },
  { value: '#F8FAFC', name: 'Slate 50' },
  { value: '#F1F5F9', name: 'Slate 100' },
  { value: '#E2E8F0', name: 'Slate 200' },
  { value: '#CBD5E1', name: 'Slate 300' },
  { value: '#94A3B8', name: 'Slate 400' },
  { value: '#64748B', name: 'Slate 500' },
  { value: '#475569', name: 'Slate 600' },
  { value: '#334155', name: 'Slate 700' },
  { value: '#1E293B', name: 'Slate 800' },
  { value: '#0F172A', name: 'Slate 900' },
  { value: '#000000', name: 'Đen' },
];

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_COLOR = /^rgb\s*\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)$/i;
const RGB_VALUES = /^(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})$/;

const toHexPart = (value: number) => Math.round(value).toString(16).padStart(2, '0').toUpperCase();

export function parseEmailColor(input?: string | null): ParsedEmailColor | null {
  const value = String(input || '').trim();
  const hexMatch = value.match(HEX_COLOR);

  if (hexMatch) {
    const raw = hexMatch[1].length === 3
      ? hexMatch[1].split('').map(part => `${part}${part}`).join('')
      : hexMatch[1];
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return { r, g, b, hex: `#${raw.toUpperCase()}`, rgb: `rgb(${r}, ${g}, ${b})` };
  }

  const rgbMatch = value.match(RGB_COLOR) || value.match(RGB_VALUES);
  if (!rgbMatch) return null;

  const channels = rgbMatch.slice(1, 4).map(Number);
  if (channels.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)) return null;
  const [r, g, b] = channels;
  return { r, g, b, hex: `#${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`, rgb: `rgb(${r}, ${g}, ${b})` };
}

export function normalizeEmailColor(input?: string | null, fallback = '#FFFFFF') {
  return parseEmailColor(input)?.hex || parseEmailColor(fallback)?.hex || '#FFFFFF';
}

export function formatEmailColor(input: string | undefined, format: 'hex' | 'rgb', fallback = '#FFFFFF') {
  const parsed = parseEmailColor(input) || parseEmailColor(fallback);
  if (!parsed) return format === 'rgb' ? 'rgb(255, 255, 255)' : '#FFFFFF';
  return format === 'rgb' ? parsed.rgb : parsed.hex;
}