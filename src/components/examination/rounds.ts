import type { ExaminationSession, SessionRound, SessionRoundSlot } from './types';

export function sessionRounds(session: ExaminationSession): SessionRound[] {
  const configured = (session.rounds || []).filter(round => String(round.name || '').trim());
  if (configured.length) return configured;
  const hasLegacyRounds = Boolean(session.national || session.nationalDate || session.international || session.internationalDate);
  if (!hasLegacyRounds) return [];
  return [
    { id: 'legacy-national', name: 'Vòng Chung kết Quốc gia', label: session.national || '', date: session.nationalDate || '' },
    { id: 'legacy-international', name: 'Vòng Chung kết Quốc tế', label: session.international || '', date: session.internationalDate || '' },
  ];
}
/** All declared calendar days of a round. Older records use only `date`; newer
 * records retain every day in `slots`. Dates are de-duplicated so a primary
 * date mirrored in a slot is never rendered twice. */
export function roundDates(round: SessionRound): string[] {
  const dates = [round.date, ...(round.slots || []).map(slot => slot.date)]
    .map(value => String(value || '').trim())
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return [...new Set(dates)].sort();
}

/** A round may run in several distinct organisation batches.  Existing slot
 * records are the source of truth, so older sessions remain compatible. */
export function roundOccurrences(round: SessionRound): SessionRoundSlot[] {
  const slots = (round.slots || []).filter(slot => String(slot.id || '').trim());
  if (slots.length) return slots;
  if (round.date || round.label) return [{ id: `${round.id || 'round'}-legacy`, label: round.label, date: round.date }];
  return [];
}
