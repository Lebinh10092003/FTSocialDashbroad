import React from 'react';

export const EMAIL_COLOR_SWATCHES = [
  { value: '#0f3a72', name: 'Fermat Deep' },
  { value: '#1473d1', name: 'Fermat Blue' },
  { value: '#16a34a', name: 'Emerald' },
  { value: '#ea580c', name: 'Orange' },
  { value: '#e11d48', name: 'Rose Red' },
  { value: '#f8fafc', name: 'Soft Slate' },
  { value: '#f1f5f9', name: 'Light Slate' },
  { value: '#1e293b', name: 'Dark Slate' },
  { value: '#ffffff', name: 'White' },
];

const HEX_3_OR_6 = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEX_6 = /^#[0-9a-fA-F]{6}$/;

function expandHex(value: string) {
  const normalized = value.trim();
  if (!/^#[0-9a-fA-F]{3}$/.test(normalized)) return normalized.toLowerCase();
  return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`.toLowerCase();
}

function normalizeHex(value: string) {
  const withHash = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
  return HEX_3_OR_6.test(withHash) ? expandHex(withHash) : null;
}

function colorInputValue(value: string | undefined, fallback: string) {
  const normalized = normalizeHex(value || '');
  return normalized && HEX_6.test(normalized) ? normalized : fallback;
}

interface ColorFieldProps {
  label: string;
  value?: string;
  fallback?: string;
  swatches?: Array<{ value: string; name: string }>;
  onChange: (color: string) => void;
}

export default function ColorField({
  label,
  value,
  fallback = '#ffffff',
  swatches = EMAIL_COLOR_SWATCHES,
  onChange,
}: ColorFieldProps) {
  const [draft, setDraft] = React.useState(value || fallback);

  React.useEffect(() => {
    setDraft(value || fallback);
  }, [fallback, value]);

  const commit = (next: string) => {
    const normalized = normalizeHex(next);
    if (!normalized) return false;
    setDraft(normalized);
    onChange(normalized);
    return true;
  };

  const pickerValue = colorInputValue(draft, fallback);
  const isDraftValid = Boolean(normalizeHex(draft));

  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-bold text-slate-500">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={event => commit(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={draft}
          onChange={event => {
            const next = event.target.value;
            setDraft(next);
            const normalized = normalizeHex(next);
            if (normalized) onChange(normalized);
          }}
          onBlur={() => {
            if (!commit(draft)) setDraft(value || fallback);
          }}
          spellCheck={false}
          className={`h-9 w-full rounded-lg border px-3 text-xs font-semibold uppercase outline-none shadow-sm transition ${
            isDraftValid ? 'border-slate-200 focus:border-blue-500' : 'border-rose-300 bg-rose-50 text-rose-700 focus:border-rose-400'
          }`}
          placeholder="#1473d1"
        />
      </div>
      <div className="grid grid-cols-9 gap-1.5 pt-0.5">
        {swatches.map(swatch => (
          <button
            key={swatch.value}
            type="button"
            onClick={() => commit(swatch.value)}
            title={swatch.name}
            className={`h-6 rounded-md border transition hover:scale-105 ${
              normalizeHex(value || '') === swatch.value
                ? 'border-white ring-2 ring-blue-550'
                : 'border-slate-250/40'
            }`}
            style={{ backgroundColor: swatch.value }}
          />
        ))}
      </div>
      {!isDraftValid ? (
        <p className="text-[9px] font-bold text-rose-600">Mã màu phải có dạng #RRGGBB hoặc #RGB.</p>
      ) : null}
    </div>
  );
}
