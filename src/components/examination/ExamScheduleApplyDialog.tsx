import { useMemo, useState } from 'react';
import { CalendarClock, Check, X } from 'lucide-react';
import type { Candidate, SessionRound, SessionRoundSlot } from './types';

type Props = {
  sessionId: string;
  round: SessionRound;
  candidateCount: number;
  idToken?: string | null;
  onApplied: (candidates: Candidate[]) => void;
};

const slotLabel = (slot: SessionRoundSlot, index: number) => {
  const pieces = [slot.date, slot.time, slot.mode].filter(Boolean);
  return pieces.length ? pieces.join(' \u00b7 ') : `L\u1ecbch / ca ${index + 1}`;
};

export default function ExamScheduleApplyDialog({ sessionId, round, candidateCount, idToken, onApplied }: Props) {
  const slots = useMemo(() => (round.slots || []).filter(slot => slot.date || slot.time || slot.mode || slot.link), [round.slots]);
  const [open, setOpen] = useState(false);
  const [slotIndex, setSlotIndex] = useState(0);
  const [applyLink, setApplyLink] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!slots.length) return null;
  const selected = slots[slotIndex] || slots[0];

  const apply = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/examination/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(round.id)}/apply-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` },
        body: JSON.stringify({ slotId: selected.id, slotIndex, applyLink }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Kh\u00f4ng th\u1ec3 \u00e1p d\u1ee5ng l\u1ecbch / ca thi.');
      onApplied(body.updatedCandidates || []);
      setOpen(false);
    } catch (requestError: any) { setError(requestError.message || 'Kh\u00f4ng th\u1ec3 \u00e1p d\u1ee5ng l\u1ecbch / ca thi.'); }
    finally { setSaving(false); }
  };

  return <>
    <button type="button" onClick={() => { setSlotIndex(0); setApplyLink(true); setError(''); setOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50"><CalendarClock className="h-4 w-4" />{'\u00c1p d\u1ee5ng l\u1ecbch / ca thi'}</button>
    {open && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase text-indigo-700">{'G\u00e1n l\u1ecbch cho th\u00ed sinh'}</p><h2 className="mt-1 text-xl font-extrabold text-[#001e40]">{round.name}</h2><p className="mt-1 text-sm text-slate-600">{'\u00c1p d\u1ee5ng cho '}{candidateCount}{' th\u00ed sinh \u0111\u1ee7 \u0111i\u1ec1u ki\u1ec7n trong v\u00f2ng.'}</p></div><button type="button" onClick={() => !saving && setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-5 grid gap-3">{slots.map((slot, index) => <button key={slot.id || index} type="button" onClick={() => setSlotIndex(index)} className={`rounded-xl border p-4 text-left ${slotIndex === index ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-3"><b className="text-[#001e40]">{'L\u1ecbch / ca '}{index + 1}</b>{slotIndex === index && <Check className="h-5 w-5 text-indigo-600" />}</div><p className="mt-2 text-sm font-semibold text-slate-700">{slotLabel(slot, index)}</p>{slot.link && <p className="mt-2 break-all text-xs text-indigo-700"><b>{'Link d\u1ef1 thi: '}</b>{slot.link}</p>}{slot.location && <p className="mt-1 text-xs text-slate-600"><b>{'\u0110\u1ecba \u0111i\u1ec3m chung: '}</b>{slot.location}</p>}</button>)}</div><label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"><input type="checkbox" checked={applyLink} onChange={event => setApplyLink(event.target.checked)} className="mt-1" /><span><b className="block text-[#001e40]">{'C\u1eadp nh\u1eadt Link d\u1ef1 thi theo ca \u0111\u00e3 ch\u1ecdn'}</b><span className="mt-1 block text-slate-600">{'Ng\u00e0y thi, gi\u1edd/ca thi v\u00e0 h\u00ecnh th\u1ee9c lu\u00f4n \u0111\u01b0\u1ee3c c\u1eadp nh\u1eadt. \u0110\u1ecba \u0111i\u1ec3m/ph\u00f2ng thi kh\u00f4ng b\u1ecb thay \u0111\u1ed5i.'}</span></span></label>{error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm font-bold">{'H\u1ee7y'}</button><button type="button" disabled={saving} onClick={apply} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '\u0110ang \u00e1p d\u1ee5ng\u2026' : '\u00c1p d\u1ee5ng cho danh s\u00e1ch th\u00ed sinh'}</button></div></div></div>}
  </>;
}
