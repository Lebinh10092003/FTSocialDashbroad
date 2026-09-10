import React from "react";

const HOURS = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0"));

type Props = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export default function Time24Input({ value, label, onChange, disabled = false, className = "" }: Props) {
  const [rawHour = "", rawMinute = ""] = value.split(":");
  const hour = HOURS.includes(rawHour) ? rawHour : "";
  const minute = MINUTES.includes(rawMinute) ? rawMinute : "00";
  return (
    <div className={`flex items-center rounded-xl border border-slate-200 bg-white px-2 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 ${disabled ? "bg-slate-50 opacity-70" : ""} ${className}`}>
      <select disabled={disabled} aria-label={`${label} - giờ`} value={hour} onChange={event => onChange(event.target.value ? `${event.target.value}:${minute}` : "")} className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-center font-semibold tabular-nums outline-none">
        <option value="">--</option>
        {HOURS.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
      <span className="font-extrabold text-slate-400">:</span>
      <select disabled={disabled || !hour} aria-label={`${label} - phút`} value={minute} onChange={event => onChange(`${hour}:${event.target.value}`)} className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-center font-semibold tabular-nums outline-none disabled:opacity-50">
        {MINUTES.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>
  );
}
